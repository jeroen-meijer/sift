use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct RootDto {
    pub id: i64,
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderNode {
    pub path: String,
    pub name: String,
    pub root_id: i64,
    pub depth: u32,
    pub is_root: bool,
    pub favorite: bool,
    pub sample_count: i64,
}

pub fn list_roots(conn: &Connection) -> AppResult<Vec<RootDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, COALESCE(label, path) FROM roots ORDER BY path COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(RootDto {
            id: row.get(0)?,
            path: row.get(1)?,
            label: row.get(2)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn add_root(conn: &Connection, path: &str) -> AppResult<RootDto> {
    let path_buf = PathBuf::from(path);
    if !path_buf.is_dir() {
        return Err(AppError::msg("path is not a directory"));
    }
    let canonical = fs::canonicalize(&path_buf).unwrap_or(path_buf);
    let path_str = canonical.to_string_lossy().to_string();
    let label = canonical
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&path_str)
        .to_string();

    conn.execute(
        "INSERT INTO roots(path, label) VALUES (?1, ?2)
         ON CONFLICT(path) DO UPDATE SET label = excluded.label",
        params![path_str, label],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM roots WHERE path = ?1",
        params![path_str],
        |r| r.get(0),
    )?;
    Ok(RootDto {
        id,
        path: path_str,
        label,
    })
}

pub fn remove_root(conn: &Connection, root_id: i64) -> AppResult<()> {
    let n = conn.execute("DELETE FROM roots WHERE id = ?1", params![root_id])?;
    if n == 0 {
        return Err(AppError::msg("root not found"));
    }
    Ok(())
}

pub fn set_folder_favorite(conn: &Connection, path: &str, favorite: bool) -> AppResult<()> {
    if favorite {
        conn.execute(
            "INSERT OR IGNORE INTO favorite_folders(path) VALUES (?1)",
            params![path],
        )?;
    } else {
        conn.execute(
            "DELETE FROM favorite_folders WHERE path = ?1",
            params![path],
        )?;
    }
    Ok(())
}

pub fn folder_tree(conn: &Connection, max_depth: u32) -> AppResult<Vec<FolderNode>> {
    let roots = list_roots(conn)?;
    let favs: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("SELECT path FROM favorite_folders")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut out = Vec::new();
    for root in roots {
        out.push(FolderNode {
            path: root.path.clone(),
            name: root.label.clone(),
            root_id: root.id,
            depth: 0,
            is_root: true,
            favorite: favs.contains(&root.path),
            sample_count: count_under(conn, &root.path)?,
        });
        walk_dirs(
            conn,
            Path::new(&root.path),
            root.id,
            1,
            max_depth,
            &favs,
            &mut out,
        )?;
    }
    Ok(out)
}

fn count_under(conn: &Connection, prefix: &str) -> AppResult<i64> {
    let like = format!("{prefix}%");
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM samples WHERE path = ?1 OR path LIKE ?2",
        params![prefix, format!("{like}/")],
        |r| r.get(0),
    )?;
    // Simpler: path starts with prefix
    let n2: i64 = conn.query_row(
        "SELECT COUNT(*) FROM samples WHERE path = ?1 OR path LIKE ?2",
        params![prefix, format!("{prefix}{}%", std::path::MAIN_SEPARATOR)],
        |r| r.get(0),
    )?;
    let _ = n;
    Ok(n2)
}

fn walk_dirs(
    conn: &Connection,
    dir: &Path,
    root_id: i64,
    depth: u32,
    max_depth: u32,
    favs: &std::collections::HashSet<String>,
    out: &mut Vec<FolderNode>,
) -> AppResult<()> {
    if depth > max_depth {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    let mut children: BTreeMap<String, PathBuf> = BTreeMap::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        children.insert(name, path);
    }

    for (name, path) in children {
        let path_str = path.to_string_lossy().to_string();
        out.push(FolderNode {
            path: path_str.clone(),
            name,
            root_id,
            depth,
            is_root: false,
            favorite: favs.contains(&path_str),
            sample_count: count_under(conn, &path_str)?,
        });
        walk_dirs(conn, &path, root_id, depth + 1, max_depth, favs, out)?;
    }
    Ok(())
}
