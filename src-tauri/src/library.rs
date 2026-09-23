use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde::Serialize;

use crate::db::models::{FavoriteFolder, NewRoot};
use crate::db::schema::favorite_folders::dsl as fav_dsl;
use crate::db::schema::roots::dsl as roots_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::error::{AppError, AppResult};
use crate::ids::{id_from_i64, id_to_i64};

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
            id: id_to_i64(id),
            label: label.unwrap_or_else(|| path.clone()),
            path,
        })
        .collect();
    out.sort_by_key(|r| r.path.to_lowercase());
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
        id: id_to_i64(id),
        path: path_str,
        label,
    })
}

pub fn remove_root(conn: &mut SqliteConnection, root_id: i64) -> AppResult<()> {
    let n = diesel::delete(roots_dsl::roots.find(id_from_i64(root_id)?)).execute(conn)?;
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

/// Build the sidebar from indexed sample paths (no filesystem walk).
///
/// Only folders that contain indexed samples (or are ancestors of those) appear.
/// Safe on Dropbox / File Provider roots.
pub fn folder_tree(conn: &mut SqliteConnection, max_depth: u32) -> AppResult<Vec<FolderNode>> {
    let roots = list_roots(conn)?;
    let favs: HashSet<String> = fav_dsl::favorite_folders
        .select(fav_dsl::path)
        .load::<String>(conn)?
        .into_iter()
        .collect();

    let rows: Vec<(i32, String, String)> = samples_dsl::samples
        .filter(samples_dsl::missing.eq(0))
        .select((
            samples_dsl::root_id,
            samples_dsl::parent_path,
            samples_dsl::path,
        ))
        .load(conn)?;

    // Inclusive sample counts under each folder prefix (built from parent_path).
    let root_by_id: HashMap<i32, &RootDto> = roots
        .iter()
        .map(|r| (id_from_i64(r.id).unwrap_or(0), r))
        .collect();

    // All folder paths that should appear (ancestors of parents, capped by depth).
    let mut folder_set: HashSet<(i32, String)> = HashSet::new();
    for (root_id_i32, parent, _) in &rows {
        let Some(root) = root_by_id.get(root_id_i32) else {
            continue;
        };
        let mut cur = parent.clone();
        loop {
            let depth = depth_under_root(&root.path, &cur);
            if depth <= max_depth {
                folder_set.insert((*root_id_i32, cur.clone()));
            }
            if cur == root.path {
                break;
            }
            let Some(parent_path) = Path::new(&cur).parent() else {
                break;
            };
            let next = parent_path.to_string_lossy().to_string();
            if next.is_empty() || next == cur {
                break;
            }
            cur = next;
        }
        folder_set.insert((*root_id_i32, root.path.clone()));
    }

    // Inclusive counts: samples under folder prefix.
    let mut inclusive: HashMap<(i32, String), i64> = HashMap::new();
    for (root_id_i32, parent, _) in &rows {
        let Some(root) = root_by_id.get(root_id_i32) else {
            continue;
        };
        let mut cur = parent.clone();
        loop {
            let key = (*root_id_i32, cur.clone());
            let n = inclusive.get(&key).copied().unwrap_or(0).saturating_add(1);
            inclusive.insert(key, n);
            if cur == root.path {
                break;
            }
            let Some(parent_path) = Path::new(&cur).parent() else {
                break;
            };
            let next = parent_path.to_string_lossy().to_string();
            if next.is_empty() || next == cur {
                break;
            }
            cur = next;
        }
    }

    let mut nodes: Vec<FolderNode> = Vec::new();
    // Ensure every root appears even with zero samples.
    for root in &roots {
        let rid = id_from_i64(root.id).unwrap_or(0);
        folder_set.insert((rid, root.path.clone()));
    }

    let mut by_root: BTreeMap<i32, Vec<String>> = BTreeMap::new();
    for (rid, path) in &folder_set {
        by_root.entry(*rid).or_default().push(path.clone());
    }

    for root in &roots {
        let rid = id_from_i64(root.id).unwrap_or(0);
        let mut paths = by_root.remove(&rid).unwrap_or_default();
        paths.sort_by_key(|p| (depth_under_root(&root.path, p), p.to_lowercase()));
        for path in paths {
            let depth = depth_under_root(&root.path, &path);
            if depth > max_depth && path != root.path {
                continue;
            }
            let name = if path == root.path {
                root.label.clone()
            } else {
                Path::new(&path)
                    .file_name()
                    .map_or_else(|| path.clone(), |s| s.to_string_lossy().into_owned())
            };
            nodes.push(FolderNode {
                path: path.clone(),
                name,
                root_id: root.id,
                depth,
                is_root: path == root.path,
                favorite: favs.contains(&path),
                sample_count: inclusive.get(&(rid, path)).copied().unwrap_or(0),
            });
        }
    }

    Ok(nodes)
}

fn depth_under_root(root: &str, path: &str) -> u32 {
    if path == root {
        return 0;
    }
    let rest = path.strip_prefix(root).unwrap_or(path);
    let rest = rest.trim_start_matches(std::path::MAIN_SEPARATOR);
    if rest.is_empty() {
        return 0;
    }
    u32::try_from(rest.split(std::path::MAIN_SEPARATOR).count()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::depth_under_root;

    #[test]
    fn depth_root_is_zero() {
        assert_eq!(depth_under_root("/a/b", "/a/b"), 0);
    }

    #[test]
    fn depth_child() {
        assert_eq!(depth_under_root("/a/b", "/a/b/c"), 1);
        assert_eq!(depth_under_root("/a/b", "/a/b/c/d"), 2);
    }
}
