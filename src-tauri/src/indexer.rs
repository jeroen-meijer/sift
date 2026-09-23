use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Serialize;
use walkdir::WalkDir;

use crate::db::models::NewSample;
use crate::db::schema::roots::dsl as roots_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::settings;
use crate::db::utc_now;
use crate::error::{AppError, AppResult};
use crate::fs_ready::{self, Availability};
use crate::ids::{id_from_i64, id_to_i64};

const AUDIO_EXTS: &[&str] = &[
    "wav", "aiff", "aif", "flac", "mp3", "aac", "m4a", "ogg", "opus",
];

#[derive(Debug, Clone, Serialize)]
pub struct IndexProgress {
    pub root_id: i64,
    pub scanned: u64,
    pub indexed: u64,
    pub skipped: u64,
    pub current_path: String,
    pub done: bool,
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

pub fn index_root(
    conn: &mut SqliteConnection,
    root_id: i64,
    mut on_progress: impl FnMut(IndexProgress),
) -> AppResult<IndexProgress> {
    let root_id_i32 = id_from_i64(root_id)?;
    let root_path: String = roots_dsl::roots
        .find(root_id_i32)
        .select(roots_dsl::path)
        .first(conn)
        .map_err(|_| AppError::msg("root not found"))?;

    let ignore = build_ignore_set(conn)?;
    let root = PathBuf::from(&root_path);
    let mut scanned = 0u64;
    let mut indexed = 0u64;
    let mut skipped = 0u64;
    let mut batch_start = Instant::now();

    for entry in WalkDir::new(&root)
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

        scanned = scanned.saturating_add(1);
        let Ok(meta) = fs::metadata(path) else {
            skipped = skipped.saturating_add(1);
            continue;
        };

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
        let mtime = mtime_ms(&meta);
        let inode = inode_of(&meta);
        let avail = fs_ready::classify_meta(&meta);
        let avail_s = avail.as_str();
        let checked = utc_now();
        let missing_flag = i32::from(avail == Availability::Missing);

        let existing: Option<(i32, Option<i64>, Option<i64>)> = samples_dsl::samples
            .filter(samples_dsl::path.eq(&path_str))
            .select((
                samples_dsl::id,
                samples_dsl::size_bytes,
                samples_dsl::mtime_ms,
            ))
            .first(conn)
            .optional()?;

        match existing {
            Some((id, old_size, old_mtime)) if old_size == Some(size) && old_mtime == mtime => {
                diesel::update(samples_dsl::samples.find(id))
                    .set((
                        samples_dsl::missing.eq(missing_flag),
                        samples_dsl::availability.eq(avail_s),
                        samples_dsl::availability_checked_at.eq(Some(checked.as_str())),
                        samples_dsl::root_id.eq(root_id_i32),
                    ))
                    .execute(conn)?;
            }
            Some((id, _, _)) => {
                diesel::update(samples_dsl::samples.find(id))
                    .set((
                        samples_dsl::root_id.eq(root_id_i32),
                        samples_dsl::filename.eq(&filename),
                        samples_dsl::parent_path.eq(&parent),
                        samples_dsl::extension.eq(&extension),
                        samples_dsl::size_bytes.eq(Some(size)),
                        samples_dsl::mtime_ms.eq(mtime),
                        samples_dsl::inode.eq(inode),
                        samples_dsl::missing.eq(missing_flag),
                        samples_dsl::availability.eq(avail_s),
                        samples_dsl::availability_checked_at.eq(Some(checked.as_str())),
                        samples_dsl::updated_at.eq(utc_now()),
                    ))
                    .execute(conn)?;
                indexed = indexed.saturating_add(1);
            }
            None => {
                diesel::insert_into(samples_dsl::samples)
                    .values(NewSample {
                        root_id: root_id_i32,
                        path: &path_str,
                        filename: &filename,
                        parent_path: &parent,
                        extension: &extension,
                        size_bytes: Some(size),
                        mtime_ms: mtime,
                        inode,
                        availability: avail_s,
                        availability_checked_at: Some(checked.as_str()),
                    })
                    .execute(conn)?;
                indexed = indexed.saturating_add(1);
            }
        }

        if scanned.is_multiple_of(25) {
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
                current_path: path_str,
                done: false,
            });
        }
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

pub fn index_all_roots(
    conn: &mut SqliteConnection,
    mut on_progress: impl FnMut(IndexProgress),
) -> AppResult<()> {
    let ids: Vec<i32> = roots_dsl::roots.select(roots_dsl::id).load(conn)?;
    for id in ids {
        index_root(conn, id_to_i64(id), &mut on_progress)?;
    }
    Ok(())
}

/// Index one or more absolute file paths that already live under a known root.
pub fn index_paths(conn: &mut SqliteConnection, paths: &[PathBuf]) -> AppResult<u64> {
    let ignore = build_ignore_set(conn)?;
    let roots = list_root_paths(conn)?;
    let mut indexed = 0u64;

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
        if upsert_sample(conn, root_id, path)? {
            indexed = indexed.saturating_add(1);
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

/// Insert or update a sample row from disk metadata. Returns true when a row was written.
pub fn upsert_sample(conn: &mut SqliteConnection, root_id: i64, path: &Path) -> AppResult<bool> {
    let Ok(meta) = fs::metadata(path) else {
        return Ok(false);
    };
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
    let mtime = mtime_ms(&meta);
    let inode = inode_of(&meta);
    let root_id_i32 = id_from_i64(root_id)?;
    let avail = fs_ready::classify_meta(&meta);
    let avail_s = avail.as_str();
    let checked = utc_now();
    let missing_flag = i32::from(avail == Availability::Missing);

    let existing: Option<(i32, Option<i64>, Option<i64>)> = samples_dsl::samples
        .filter(samples_dsl::path.eq(&path_str))
        .select((
            samples_dsl::id,
            samples_dsl::size_bytes,
            samples_dsl::mtime_ms,
        ))
        .first(conn)
        .optional()?;

    match existing {
        Some((id, old_size, old_mtime)) if old_size == Some(size) && old_mtime == mtime => {
            diesel::update(samples_dsl::samples.find(id))
                .set((
                    samples_dsl::missing.eq(missing_flag),
                    samples_dsl::availability.eq(avail_s),
                    samples_dsl::availability_checked_at.eq(Some(checked.as_str())),
                    samples_dsl::root_id.eq(root_id_i32),
                ))
                .execute(conn)?;
            Ok(false)
        }
        Some((id, _, _)) => {
            diesel::update(samples_dsl::samples.find(id))
                .set((
                    samples_dsl::root_id.eq(root_id_i32),
                    samples_dsl::filename.eq(&filename),
                    samples_dsl::parent_path.eq(&parent),
                    samples_dsl::extension.eq(&extension),
                    samples_dsl::size_bytes.eq(Some(size)),
                    samples_dsl::mtime_ms.eq(mtime),
                    samples_dsl::inode.eq(inode),
                    samples_dsl::missing.eq(missing_flag),
                    samples_dsl::availability.eq(avail_s),
                    samples_dsl::availability_checked_at.eq(Some(checked.as_str())),
                    samples_dsl::updated_at.eq(utc_now()),
                ))
                .execute(conn)?;
            Ok(true)
        }
        None => {
            diesel::insert_into(samples_dsl::samples)
                .values(NewSample {
                    root_id: root_id_i32,
                    path: &path_str,
                    filename: &filename,
                    parent_path: &parent,
                    extension: &extension,
                    size_bytes: Some(size),
                    mtime_ms: mtime,
                    inode,
                    availability: avail_s,
                    availability_checked_at: Some(checked.as_str()),
                })
                .execute(conn)?;
            Ok(true)
        }
    }
}
