use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use globset::{Glob, GlobSet, GlobSetBuilder};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use walkdir::WalkDir;

use crate::db::settings;
use crate::error::{AppError, AppResult};

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
        .map(|e| AUDIO_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
        .unwrap_or(false)
}

fn build_ignore_set(conn: &Connection) -> AppResult<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    let list = settings::get(conn, "ignore_list")?
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    for item in list {
        if let Some(pat) = item.as_str() {
            if let Ok(glob) = Glob::new(pat) {
                builder.add(glob);
            }
        }
    }
    Ok(builder.build().map_err(|e| AppError::msg(e.to_string()))?)
}

fn mtime_ms(meta: &fs::Metadata) -> Option<i64> {
    meta.modified().ok().and_then(|t| {
        t.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis() as i64)
    })
}

#[cfg(unix)]
fn inode_of(meta: &fs::Metadata) -> Option<i64> {
    use std::os::unix::fs::MetadataExt;
    Some(meta.ino() as i64)
}

#[cfg(not(unix))]
fn inode_of(_meta: &fs::Metadata) -> Option<i64> {
    None
}

pub fn index_root(
    conn: &Connection,
    root_id: i64,
    mut on_progress: impl FnMut(IndexProgress),
) -> AppResult<IndexProgress> {
    let root_path: String = conn
        .query_row(
            "SELECT path FROM roots WHERE id = ?1",
            params![root_id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::msg("root not found"))?;

    let ignore = build_ignore_set(conn)?;
    let root = PathBuf::from(&root_path);
    let mut scanned = 0u64;
    let mut indexed = 0u64;
    let mut skipped = 0u64;

    for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();

        if ignore.is_match(&path_str) || ignore.is_match(path) {
            skipped += 1;
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if !is_audio_file(path) {
            skipped += 1;
            continue;
        }

        scanned += 1;
        let meta = match fs::metadata(path) {
            Ok(m) => m,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let parent = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let size = meta.len() as i64;
        let mtime = mtime_ms(&meta);
        let inode = inode_of(&meta);

        let existing: Option<(i64, Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT id, size_bytes, mtime_ms FROM samples WHERE path = ?1",
                params![path_str],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;

        match existing {
            Some((id, old_size, old_mtime))
                if old_size == Some(size) && old_mtime == mtime =>
            {
                // unchanged
                conn.execute(
                    "UPDATE samples SET missing = 0, root_id = ?1 WHERE id = ?2",
                    params![root_id, id],
                )?;
            }
            Some((id, _, _)) => {
                conn.execute(
                    "UPDATE samples SET root_id = ?1, filename = ?2, parent_path = ?3, extension = ?4,
                     size_bytes = ?5, mtime_ms = ?6, inode = ?7, missing = 0,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE id = ?8",
                    params![root_id, filename, parent, extension, size, mtime, inode, id],
                )?;
                indexed += 1;
            }
            None => {
                conn.execute(
                    "INSERT INTO samples(root_id, path, filename, parent_path, extension, size_bytes, mtime_ms, inode)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![root_id, path_str, filename, parent, extension, size, mtime, inode],
                )?;
                indexed += 1;
            }
        }

        if scanned % 25 == 0 {
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

    // Mark missing files under this root that were not seen — skip for first full index pass
    // (Phase 14 watch handles continuous missing). Optional: could compare set.

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
    conn: &Connection,
    mut on_progress: impl FnMut(IndexProgress),
) -> AppResult<()> {
    let mut stmt = conn.prepare("SELECT id FROM roots")?;
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    for id in ids {
        index_root(conn, id, &mut on_progress)?;
    }
    Ok(())
}

/// Index one or more absolute file paths that already live under a known root.
pub fn index_paths(conn: &Connection, paths: &[PathBuf]) -> AppResult<u64> {
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
            indexed += 1;
        }
    }
    Ok(indexed)
}

fn list_root_paths(conn: &Connection) -> AppResult<Vec<(i64, PathBuf)>> {
    let mut stmt = conn.prepare("SELECT id, path FROM roots")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, PathBuf::from(r.get::<_, String>(1)?))))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn find_root_for(roots: &[(i64, PathBuf)], path: &Path) -> Option<(i64, PathBuf)> {
    roots
        .iter()
        .filter(|(_, root)| path.starts_with(root))
        .max_by_key(|(_, root)| root.as_os_str().len())
        .map(|(id, root)| (*id, root.clone()))
}

/// Insert or update a sample row from disk metadata. Returns true when a row was written.
pub fn upsert_sample(conn: &Connection, root_id: i64, path: &Path) -> AppResult<bool> {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(false),
    };
    let path_str = path.to_string_lossy().to_string();
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let size = meta.len() as i64;
    let mtime = mtime_ms(&meta);
    let inode = inode_of(&meta);

    let existing: Option<(i64, Option<i64>, Option<i64>)> = conn
        .query_row(
            "SELECT id, size_bytes, mtime_ms FROM samples WHERE path = ?1",
            params![path_str],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;

    match existing {
        Some((id, old_size, old_mtime)) if old_size == Some(size) && old_mtime == mtime => {
            conn.execute(
                "UPDATE samples SET missing = 0, root_id = ?1 WHERE id = ?2",
                params![root_id, id],
            )?;
            Ok(false)
        }
        Some((id, _, _)) => {
            conn.execute(
                "UPDATE samples SET root_id = ?1, filename = ?2, parent_path = ?3, extension = ?4,
                 size_bytes = ?5, mtime_ms = ?6, inode = ?7, missing = 0,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?8",
                params![root_id, filename, parent, extension, size, mtime, inode, id],
            )?;
            Ok(true)
        }
        None => {
            conn.execute(
                "INSERT INTO samples(root_id, path, filename, parent_path, extension, size_bytes, mtime_ms, inode)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![root_id, path_str, filename, parent, extension, size, mtime, inode],
            )?;
            Ok(true)
        }
    }
}
