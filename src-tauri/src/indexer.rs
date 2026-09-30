use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Serialize;
use walkdir::WalkDir;

use crate::db::Db;
use crate::db::models::NewSample;
use crate::db::schema::roots::dsl as roots_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::settings;
use crate::db::utc_now;
use crate::error::{AppError, AppResult};
use crate::fs_dates;
use crate::fs_ready::{self, Availability};
use crate::ids::{id_from_i64, id_to_i64};
use crate::samples;

const AUDIO_EXTS: &[&str] = &[
    "wav", "aiff", "aif", "flac", "mp3", "aac", "m4a", "ogg", "opus",
];

/// How many file records to write per short DB transaction.
const INDEX_BATCH: usize = 64;

#[derive(Debug, Clone, Serialize)]
pub struct IndexProgress {
    pub root_id: i64,
    pub scanned: u64,
    pub indexed: u64,
    pub skipped: u64,
    pub current_path: String,
    pub done: bool,
}

#[derive(Debug, Clone)]
struct FileRecord {
    path: String,
    filename: String,
    parent: String,
    extension: String,
    size: i64,
    mtime: Option<i64>,
    inode: Option<i64>,
    date_created: Option<i64>,
    date_added: Option<i64>,
    availability: String,
    missing_flag: i32,
}

/// Present sample row used when merging a missing row onto a unique inode match.
#[derive(Queryable)]
struct PresentByInode {
    id: i32,
    path: String,
    inode: Option<i64>,
    size_bytes: Option<i64>,
    mtime_ms: Option<i64>,
    extension: String,
    availability: String,
    date_added_ms: Option<i64>,
    date_created_ms: Option<i64>,
}

impl PresentByInode {
    fn as_file_record(&self) -> FileRecord {
        let parent = Path::new(&self.path)
            .parent()
            .map_or_default(|p| p.to_string_lossy().to_string());
        let filename = Path::new(&self.path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        FileRecord {
            path: self.path.clone(),
            filename,
            parent,
            extension: self.extension.clone(),
            size: self.size_bytes.unwrap_or(0),
            mtime: self.mtime_ms,
            inode: self.inode,
            date_created: self.date_created_ms,
            date_added: self.date_added_ms,
            availability: self.availability.clone(),
            missing_flag: 0,
        }
    }
}

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| AUDIO_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

fn build_ignore_set(conn: &mut SqliteConnection) -> AppResult<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    let list = settings::get(conn, "ignore_list")?
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    for item in list {
        if let Some(pat) = item.as_str()
            && let Ok(glob) = Glob::new(pat)
        {
            builder.add(glob);
        }
    }
    builder.build().map_err(|e| AppError::msg(e.to_string()))
}

fn mtime_ms(meta: &fs::Metadata) -> Option<i64> {
    meta.modified().ok().and_then(|t| {
        t.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .and_then(|d| i64::try_from(d.as_millis()).ok())
    })
}

#[cfg(unix)]
fn inode_of(meta: &fs::Metadata) -> Option<i64> {
    use std::os::unix::fs::MetadataExt;
    i64::try_from(meta.ino()).ok()
}

#[cfg(not(unix))]
fn inode_of(_meta: &fs::Metadata) -> Option<i64> {
    None
}

fn file_record_from_meta(path: &Path, meta: &fs::Metadata) -> FileRecord {
    let path_str = path.to_string_lossy().to_string();
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let parent = path
        .parent()
        .map_or_default(|p| p.to_string_lossy().to_string());
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let size = i64::try_from(meta.len()).unwrap_or(i64::MAX);
    let avail = fs_ready::classify_meta(meta);
    FileRecord {
        path: path_str,
        filename,
        parent,
        extension,
        size,
        mtime: mtime_ms(meta),
        inode: inode_of(meta),
        date_created: fs_dates::date_created_ms(meta),
        date_added: fs_dates::date_added_ms(path),
        availability: avail.as_str().to_string(),
        missing_flag: i32::from(avail == Availability::Missing),
    }
}

/// Match missing sample rows under `root_id` to walk records (`incoming`) or
/// to unique present DB rows by inode. Returns paths from `incoming` that were
/// merged (caller should skip inserting those).
fn reconcile_inode_moves(
    conn: &mut SqliteConnection,
    root_id: i64,
    incoming: &[FileRecord],
) -> AppResult<std::collections::HashSet<String>> {
    let root_id_i32 = id_from_i64(root_id)?;
    let missing: Vec<(i32, Option<i64>)> = samples_dsl::samples
        .filter(samples_dsl::root_id.eq(root_id_i32))
        .filter(samples_dsl::missing.ne(0))
        .filter(samples_dsl::inode.is_not_null())
        .select((samples_dsl::id, samples_dsl::inode))
        .load(conn)?;

    let mut missing_by_inode: HashMap<i64, Vec<i32>> = HashMap::new();
    for (id, inode) in missing {
        if let Some(ino) = inode {
            missing_by_inode.entry(ino).or_default().push(id);
        }
    }

    let mut merged_paths = std::collections::HashSet::new();

    let mut incoming_by_inode: HashMap<i64, Vec<&FileRecord>> = HashMap::new();
    for rec in incoming {
        if let Some(ino) = rec.inode {
            incoming_by_inode.entry(ino).or_default().push(rec);
        }
    }
    for (ino, miss_ids) in &missing_by_inode {
        if miss_ids.len() != 1 {
            continue;
        }
        let Some(recs) = incoming_by_inode.get(ino) else {
            continue;
        };
        if recs.len() != 1 {
            continue;
        }
        let Some(old_id) = miss_ids.first().copied() else {
            continue;
        };
        let Some(rec) = recs.first() else {
            continue;
        };
        apply_inode_merge(conn, old_id, rec, None)?;
        merged_paths.insert(rec.path.clone());
    }

    let present: Vec<PresentByInode> = samples_dsl::samples
        .filter(samples_dsl::root_id.eq(root_id_i32))
        .filter(samples_dsl::missing.eq(0))
        .filter(samples_dsl::inode.is_not_null())
        .select((
            samples_dsl::id,
            samples_dsl::path,
            samples_dsl::inode,
            samples_dsl::size_bytes,
            samples_dsl::mtime_ms,
            samples_dsl::extension,
            samples_dsl::availability,
            samples_dsl::date_added_ms,
            samples_dsl::date_created_ms,
        ))
        .load(conn)?;
    let mut present_by_inode: HashMap<i64, Vec<PresentByInode>> = HashMap::new();
    for row in present {
        if let Some(ino) = row.inode {
            present_by_inode.entry(ino).or_default().push(row);
        }
    }
    for (ino, miss_ids) in &missing_by_inode {
        if miss_ids.len() != 1 {
            continue;
        }
        let Some(pres) = present_by_inode.get(ino) else {
            continue;
        };
        if pres.len() != 1 {
            continue;
        }
        let Some(old_id) = miss_ids.first().copied() else {
            continue;
        };
        let Some(row) = pres.first() else {
            continue;
        };
        if old_id == row.id || merged_paths.contains(&row.path) {
            continue;
        }
        apply_inode_merge(conn, old_id, &row.as_file_record(), Some(row.id))?;
        merged_paths.insert(row.path.clone());
    }
    Ok(merged_paths)
}

fn apply_inode_merge(
    conn: &mut SqliteConnection,
    old_id: i32,
    rec: &FileRecord,
    drop_duplicate_id: Option<i32>,
) -> AppResult<()> {
    if let Some(dup_id) = drop_duplicate_id {
        diesel::delete(samples_dsl::samples.find(dup_id)).execute(conn)?;
    }
    diesel::update(samples_dsl::samples.find(old_id))
        .set((
            samples_dsl::path.eq(rec.path.as_str()),
            samples_dsl::parent_path.eq(rec.parent.as_str()),
            samples_dsl::filename.eq(rec.filename.as_str()),
            samples_dsl::extension.eq(rec.extension.as_str()),
            samples_dsl::size_bytes.eq(Some(rec.size)),
            samples_dsl::mtime_ms.eq(rec.mtime),
            samples_dsl::inode.eq(rec.inode),
            samples_dsl::missing.eq(0),
            samples_dsl::availability.eq(rec.availability.as_str()),
            samples_dsl::date_added_ms.eq(rec.date_added),
            samples_dsl::date_created_ms.eq(rec.date_created),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    Ok(())
}

/// Walk and index one library folder. Filesystem walk and per-file stat run
/// outside the DB mutex. Writes happen in batches of [`INDEX_BATCH`].
pub fn index_root(
    db: &Db,
    root_id: i64,
    mut on_progress: impl FnMut(IndexProgress),
) -> AppResult<IndexProgress> {
    index_tree(db, root_id, None, &mut on_progress)
}

/// Index a full library root, or only files under `subtree` when set.
pub fn index_tree(
    db: &Db,
    root_id: i64,
    subtree: Option<&Path>,
    mut on_progress: impl FnMut(IndexProgress),
) -> AppResult<IndexProgress> {
    let (root_path, ignore) = db.with_conn(|conn| {
        let root_id_i32 = id_from_i64(root_id)?;
        let root_path: String = roots_dsl::roots
            .find(root_id_i32)
            .select(roots_dsl::path)
            .first(conn)
            .map_err(|_| AppError::msg("root not found"))?;
        let ignore = build_ignore_set(conn)?;
        Ok((root_path, ignore))
    })?;

    let walk_root = subtree.map_or_else(|| PathBuf::from(&root_path), PathBuf::from);
    let mut records: Vec<FileRecord> = Vec::new();
    let mut skipped = 0u64;

    for entry in WalkDir::new(&walk_root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();

        if ignore.is_match(&path_str) || ignore.is_match(path) {
            skipped = skipped.saturating_add(1);
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if !is_audio_file(path) {
            skipped = skipped.saturating_add(1);
            continue;
        }

        let Ok(meta) = fs::metadata(path) else {
            skipped = skipped.saturating_add(1);
            continue;
        };
        records.push(file_record_from_meta(path, &meta));
    }

    let merged = db.with_conn(|conn| {
        conn.transaction(|conn| reconcile_inode_moves(conn, root_id, &records))
    })?;
    records.retain(|r| !merged.contains(&r.path));

    let scanned = u64::try_from(records.len().saturating_add(merged.len())).unwrap_or(u64::MAX);
    let mut indexed = u64::try_from(merged.len()).unwrap_or(0);
    let mut batch_start = Instant::now();
    let mut current_path = String::new();

    for chunk in records.chunks(INDEX_BATCH) {
        let written = db.with_conn(|conn| {
            conn.transaction(|conn| {
                let mut n = 0u64;
                for rec in chunk {
                    if write_file_record(conn, root_id, rec)? {
                        n = n.saturating_add(1);
                    }
                }
                Ok(n)
            })
        })?;
        indexed = indexed.saturating_add(written);
        if let Some(last) = chunk.last() {
            current_path.clone_from(&last.path);
        }
        crate::profile_log::event(
            "index.batch",
            batch_start.elapsed(),
            &format!("scanned={scanned} indexed={indexed} skipped={skipped}"),
        );
        batch_start = Instant::now();
        on_progress(IndexProgress {
            root_id,
            scanned,
            indexed,
            skipped,
            current_path: current_path.clone(),
            done: false,
        });
    }

    let done = IndexProgress {
        root_id,
        scanned,
        indexed,
        skipped,
        current_path: String::new(),
        done: true,
    };
    on_progress(done.clone());
    Ok(done)
}

fn write_file_record(
    conn: &mut SqliteConnection,
    root_id: i64,
    rec: &FileRecord,
) -> AppResult<bool> {
    let root_id_i32 = id_from_i64(root_id)?;
    let checked = utc_now();
    let existing: Option<(i32, Option<i64>, Option<i64>)> = samples_dsl::samples
        .filter(samples_dsl::path.eq(&rec.path))
        .select((
            samples_dsl::id,
            samples_dsl::size_bytes,
            samples_dsl::mtime_ms,
        ))
        .first(conn)
        .optional()?;

    match existing {
        Some((id, old_size, old_mtime)) if old_size == Some(rec.size) && old_mtime == rec.mtime => {
            diesel::update(samples_dsl::samples.find(id))
                .set((
                    samples_dsl::missing.eq(rec.missing_flag),
                    samples_dsl::availability.eq(rec.availability.as_str()),
                    samples_dsl::availability_checked_at.eq(Some(checked.as_str())),
                    samples_dsl::root_id.eq(root_id_i32),
                    samples_dsl::date_added_ms.eq(rec.date_added),
                    samples_dsl::date_created_ms.eq(rec.date_created),
                ))
                .execute(conn)?;
            Ok(false)
        }
        Some((id, _, _)) => {
            diesel::update(samples_dsl::samples.find(id))
                .set((
                    samples_dsl::root_id.eq(root_id_i32),
                    samples_dsl::filename.eq(&rec.filename),
                    samples_dsl::parent_path.eq(&rec.parent),
                    samples_dsl::extension.eq(&rec.extension),
                    samples_dsl::size_bytes.eq(Some(rec.size)),
                    samples_dsl::mtime_ms.eq(rec.mtime),
                    samples_dsl::inode.eq(rec.inode),
                    samples_dsl::missing.eq(rec.missing_flag),
                    samples_dsl::availability.eq(rec.availability.as_str()),
                    samples_dsl::availability_checked_at.eq(Some(checked.as_str())),
                    samples_dsl::date_added_ms.eq(rec.date_added),
                    samples_dsl::date_created_ms.eq(rec.date_created),
                    samples_dsl::updated_at.eq(utc_now()),
                ))
                .execute(conn)?;
            Ok(true)
        }
        None => {
            diesel::insert_into(samples_dsl::samples)
                .values(NewSample {
                    root_id: root_id_i32,
                    path: &rec.path,
                    filename: &rec.filename,
                    parent_path: &rec.parent,
                    extension: &rec.extension,
                    size_bytes: Some(rec.size),
                    mtime_ms: rec.mtime,
                    inode: rec.inode,
                    availability: rec.availability.as_str(),
                    availability_checked_at: Some(checked.as_str()),
                    date_added_ms: rec.date_added,
                    date_created_ms: rec.date_created,
                })
                .execute(conn)?;
            Ok(true)
        }
    }
}

pub fn index_all_roots(db: &Db, mut on_progress: impl FnMut(IndexProgress)) -> AppResult<()> {
    let ids: Vec<i64> = db.with_conn(|conn| {
        let ids: Vec<i32> = roots_dsl::roots.select(roots_dsl::id).load(conn)?;
        Ok(ids.into_iter().map(id_to_i64).collect())
    })?;
    for id in ids {
        index_root(db, id, &mut on_progress)?;
    }
    Ok(())
}

/// Index one or more absolute file paths that already live under a known root.
/// Collects file records outside the DB lock, then writes in a short transaction.
pub fn index_paths(db: &Db, paths: &[PathBuf]) -> AppResult<u64> {
    let (ignore, roots) =
        db.with_conn(|conn| Ok((build_ignore_set(conn)?, list_root_paths(conn)?)))?;

    let mut by_root: HashMap<i64, Vec<FileRecord>> = HashMap::new();
    for path in paths {
        let path_str = path.to_string_lossy().to_string();
        if ignore.is_match(&path_str) || ignore.is_match(path.as_path()) {
            continue;
        }
        if !path.is_file() || !is_audio_file(path) {
            continue;
        }
        let Some((root_id, _)) = find_root_for(&roots, path) else {
            continue;
        };
        let Ok(meta) = fs::metadata(path) else {
            continue;
        };
        by_root
            .entry(root_id)
            .or_default()
            .push(file_record_from_meta(path, &meta));
    }

    let mut indexed = 0u64;
    for (root_id, records) in by_root {
        let merged = db.with_conn(|conn| {
            conn.transaction(|conn| reconcile_inode_moves(conn, root_id, &records))
        })?;
        let remaining: Vec<_> = records
            .into_iter()
            .filter(|r| !merged.contains(&r.path))
            .collect();
        indexed = indexed.saturating_add(u64::try_from(merged.len()).unwrap_or(0));
        for chunk in remaining.chunks(INDEX_BATCH) {
            let written = db.with_conn(|conn| {
                conn.transaction(|conn| {
                    let mut n = 0u64;
                    for rec in chunk {
                        if write_file_record(conn, root_id, rec)? {
                            n = n.saturating_add(1);
                        }
                    }
                    Ok(n)
                })
            })?;
            indexed = indexed.saturating_add(written);
        }
    }
    Ok(indexed)
}

fn list_root_paths(conn: &mut SqliteConnection) -> AppResult<Vec<(i64, PathBuf)>> {
    let rows: Vec<(i32, String)> = roots_dsl::roots
        .select((roots_dsl::id, roots_dsl::path))
        .load(conn)?;
    Ok(rows
        .into_iter()
        .map(|(id, path)| (id_to_i64(id), PathBuf::from(path)))
        .collect())
}

fn find_root_for(roots: &[(i64, PathBuf)], path: &Path) -> Option<(i64, PathBuf)> {
    roots
        .iter()
        .filter(|(_, root)| path.starts_with(root))
        .max_by_key(|(_, root)| root.as_os_str().len())
        .map(|(id, root)| (*id, root.clone()))
}

/// Library root that covers `path`, preferring the longest matching root path.
pub fn root_id_for_path(db: &Db, path: &Path) -> AppResult<Option<i64>> {
    db.with_conn(|conn| {
        let roots = list_root_paths(conn)?;
        Ok(find_root_for(&roots, path).map(|(id, _)| id))
    })
}

/// Rewrite descendant sample paths when a library folder is renamed, or mark
/// them missing when the folder disappeared.
pub fn apply_directory_path_change(db: &Db, from: &Path, to: Option<&Path>) -> AppResult<bool> {
    let from_s = from.to_string_lossy().to_string();
    let like = format!(
        "{}{}%",
        crate::db::escape_like(&from_s),
        std::path::MAIN_SEPARATOR
    );
    db.with_conn(|conn| {
        conn.transaction(|conn| {
            if let Some(to) = to {
                let to_s = to.to_string_lossy().to_string();
                let rows: Vec<(i32, String)> = samples_dsl::samples
                    .filter(
                        samples_dsl::path
                            .eq(&from_s)
                            .or(samples_dsl::path.like(&like).escape('\\'))
                            .or(samples_dsl::parent_path
                                .eq(&from_s)
                                .or(samples_dsl::parent_path.like(&like).escape('\\'))),
                    )
                    .select((samples_dsl::id, samples_dsl::path))
                    .load(conn)?;
                if rows.is_empty() {
                    return Ok(false);
                }
                for (_id, old_path) in rows {
                    let new_path = if old_path == from_s {
                        to_s.clone()
                    } else if let Some(suffix) = old_path.strip_prefix(&from_s) {
                        format!("{to_s}{suffix}")
                    } else {
                        continue;
                    };
                    let _ = samples::update_path(conn, &old_path, &new_path)?;
                }
                Ok(true)
            } else {
                let n = diesel::update(
                    samples_dsl::samples.filter(
                        samples_dsl::path
                            .eq(&from_s)
                            .or(samples_dsl::path.like(&like).escape('\\'))
                            .or(samples_dsl::parent_path
                                .eq(&from_s)
                                .or(samples_dsl::parent_path.like(&like).escape('\\'))),
                    ),
                )
                .set((
                    samples_dsl::missing.eq(1),
                    samples_dsl::availability.eq("missing"),
                    samples_dsl::updated_at.eq(utc_now()),
                ))
                .execute(conn)?;
                Ok(n > 0)
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::{index_root, is_audio_file, reconcile_inode_moves};
    use crate::db::schema::roots::dsl as roots_dsl;
    use crate::db::schema::samples::dsl as samples_dsl;
    use crate::ids::id_to_i64;
    use diesel::prelude::*;
    use std::fs;
    use std::sync::{Arc, Mutex};

    #[test]
    fn audio_ext_check() {
        assert!(is_audio_file(std::path::Path::new("a.WAV")));
        assert!(!is_audio_file(std::path::Path::new("a.txt")));
    }

    #[test]
    fn index_root_releases_lock_between_batches() {
        let dir = tempfile::tempdir().expect("temp");
        let lib = dir.path().join("lib");
        fs::create_dir_all(&lib).unwrap();
        for i in 0..70 {
            fs::write(lib.join(format!("s{i}.wav")), b"RIFF").unwrap();
        }

        let paths = crate::paths::AppPaths::for_test(dir.path());
        let (db, _) = crate::db::Db::open(&paths).expect("db");
        let db = Arc::new(db);
        let root_id = db
            .with_conn(|conn| {
                diesel::insert_into(roots_dsl::roots)
                    .values((
                        roots_dsl::path.eq(lib.to_str().unwrap()),
                        roots_dsl::label.eq("lib"),
                    ))
                    .execute(conn)?;
                let id: i32 = roots_dsl::roots.select(roots_dsl::id).first(conn)?;
                Ok(id_to_i64(id))
            })
            .unwrap();

        let saw_read = Arc::new(Mutex::new(false));
        let saw_read_bg = Arc::clone(&saw_read);
        let db_bg = Arc::clone(&db);
        let handle = std::thread::spawn(move || {
            // Busy-wait until indexer releases the lock for a concurrent read.
            for _ in 0..200 {
                if db_bg
                    .with_conn(|conn| {
                        let _: i64 = samples_dsl::samples.count().get_result(conn).unwrap_or(0);
                        Ok(())
                    })
                    .is_ok()
                {
                    *saw_read_bg.lock().unwrap() = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        });

        let progress = index_root(&db, root_id, |_| {}).expect("index");
        handle.join().unwrap();
        assert!(progress.scanned >= 70);
        assert!(
            *saw_read.lock().unwrap(),
            "another with_conn should succeed while indexing"
        );
    }

    #[test]
    fn reconcile_merges_unique_inode() {
        let mut conn = crate::db::test_conn();
        diesel::insert_into(roots_dsl::roots)
            .values((roots_dsl::path.eq("/lib"), roots_dsl::label.eq("lib")))
            .execute(&mut conn)
            .unwrap();
        let root_id: i32 = roots_dsl::roots
            .select(roots_dsl::id)
            .first(&mut conn)
            .unwrap();
        diesel::insert_into(samples_dsl::samples)
            .values((
                samples_dsl::root_id.eq(root_id),
                samples_dsl::path.eq("/lib/old.wav"),
                samples_dsl::filename.eq("old.wav"),
                samples_dsl::parent_path.eq("/lib"),
                samples_dsl::extension.eq("wav"),
                samples_dsl::inode.eq(Some(42i64)),
                samples_dsl::missing.eq(1),
                samples_dsl::availability.eq("missing"),
            ))
            .execute(&mut conn)
            .unwrap();
        diesel::insert_into(samples_dsl::samples)
            .values((
                samples_dsl::root_id.eq(root_id),
                samples_dsl::path.eq("/lib/new.wav"),
                samples_dsl::filename.eq("new.wav"),
                samples_dsl::parent_path.eq("/lib"),
                samples_dsl::extension.eq("wav"),
                samples_dsl::inode.eq(Some(42i64)),
                samples_dsl::missing.eq(0),
                samples_dsl::availability.eq("local"),
            ))
            .execute(&mut conn)
            .unwrap();

        let n = reconcile_inode_moves(&mut conn, id_to_i64(root_id), &[])
            .unwrap()
            .len();
        assert_eq!(n, 1);
        let count: i64 = samples_dsl::samples.count().get_result(&mut conn).unwrap();
        assert_eq!(count, 1);
        let path: String = samples_dsl::samples
            .select(samples_dsl::path)
            .first(&mut conn)
            .unwrap();
        assert_eq!(path, "/lib/new.wav");
        let missing: i32 = samples_dsl::samples
            .select(samples_dsl::missing)
            .first(&mut conn)
            .unwrap();
        assert_eq!(missing, 0);
    }
}
