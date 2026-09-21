use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use diesel::dsl::count_star;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde::Serialize;

use crate::db::models::{FavoriteFolder, NewRoot};
use crate::db::schema::favorite_folders::dsl as fav_dsl;
use crate::db::schema::roots::dsl as roots_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
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

pub fn list_roots(conn: &mut SqliteConnection) -> AppResult<Vec<RootDto>> {
    let rows: Vec<(i32, String, Option<String>)> = roots_dsl::roots
        .select((roots_dsl::id, roots_dsl::path, roots_dsl::label))
        .order(roots_dsl::path.asc())
        .load(conn)?;

    let mut out: Vec<RootDto> = rows
        .into_iter()
        .map(|(id, path, label)| RootDto {
            id: id as i64,
            label: label.unwrap_or_else(|| path.clone()),
            path,
        })
        .collect();
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

pub fn add_root(conn: &mut SqliteConnection, path: &str) -> AppResult<RootDto> {
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

    diesel::insert_into(roots_dsl::roots)
        .values(NewRoot {
            path: &path_str,
            label: Some(&label),
        })
        .on_conflict(roots_dsl::path)
        .do_update()
        .set(roots_dsl::label.eq(&label))
        .execute(conn)?;

    let id: i32 = roots_dsl::roots
        .filter(roots_dsl::path.eq(&path_str))
        .select(roots_dsl::id)
        .first(conn)?;

    Ok(RootDto {
        id: id as i64,
        path: path_str,
        label,
    })
}

pub fn remove_root(conn: &mut SqliteConnection, root_id: i64) -> AppResult<()> {
    let n = diesel::delete(roots_dsl::roots.find(root_id as i32)).execute(conn)?;
    if n == 0 {
        return Err(AppError::msg("root not found"));
    }
    Ok(())
}

pub fn set_folder_favorite(
    conn: &mut SqliteConnection,
    path: &str,
    favorite: bool,
) -> AppResult<()> {
    if favorite {
        diesel::insert_into(fav_dsl::favorite_folders)
            .values(FavoriteFolder {
                path: path.to_string(),
                created_at: crate::db::utc_now(),
            })
            .on_conflict_do_nothing()
            .execute(conn)?;
    } else {
        diesel::delete(fav_dsl::favorite_folders.find(path)).execute(conn)?;
    }
    Ok(())
}

pub fn folder_tree(conn: &mut SqliteConnection, max_depth: u32) -> AppResult<Vec<FolderNode>> {
    let roots = list_roots(conn)?;
    let favs: HashSet<String> = fav_dsl::favorite_folders
        .select(fav_dsl::path)
        .load::<String>(conn)?
        .into_iter()
        .collect();

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

fn count_under(conn: &mut SqliteConnection, prefix: &str) -> AppResult<i64> {
    let like = format!("{}{}%", prefix, std::path::MAIN_SEPARATOR);
    let n: i64 = samples_dsl::samples
        .filter(
            samples_dsl::path
                .eq(prefix)
                .or(samples_dsl::path.like(like)),
        )
        .select(count_star())
        .first(conn)?;
    Ok(n)
}

fn walk_dirs(
    conn: &mut SqliteConnection,
    dir: &Path,
    root_id: i64,
    depth: u32,
    max_depth: u32,
    favs: &HashSet<String>,
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
