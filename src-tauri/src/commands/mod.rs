use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::db::settings;
use crate::error::AppResult;
use crate::indexer::{self, IndexProgress};
use crate::library::{self, FolderNode, RootDto};
use crate::state::AppState;

#[derive(serde::Serialize)]
pub struct DbStats {
    pub roots: i64,
    pub samples: i64,
    pub tags: i64,
    pub data_dir: String,
    pub clips_dir: String,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Value> {
    state.db.with_conn(settings::get_all)
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: Value) -> AppResult<()> {
    state.db.with_conn(|conn| settings::set(conn, &key, &value))
}

#[tauri::command]
pub fn db_stats(state: State<'_, AppState>) -> AppResult<DbStats> {
    state.db.with_conn(|conn| {
        let roots: i64 = conn.query_row("SELECT COUNT(*) FROM roots", [], |r| r.get(0))?;
        let samples: i64 = conn.query_row("SELECT COUNT(*) FROM samples", [], |r| r.get(0))?;
        let tags: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;
        Ok(DbStats {
            roots,
            samples,
            tags,
            data_dir: state.paths.data_dir.to_string_lossy().into_owned(),
            clips_dir: state.paths.clips_dir.to_string_lossy().into_owned(),
        })
    })
}

#[tauri::command]
pub fn list_roots(state: State<'_, AppState>) -> AppResult<Vec<RootDto>> {
    state.db.with_conn(library::list_roots)
}

#[tauri::command]
pub fn add_root(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<RootDto> {
    let root = state.db.with_conn(|conn| library::add_root(conn, &path))?;
    let root_id = root.id;
    let db = state.db.clone();
    std::thread::spawn(move || {
        let _ = db.with_conn(|conn| {
            indexer::index_root(conn, root_id, |progress| {
                let _ = app.emit("index-progress", &progress);
            })
        });
        let _ = app.emit(
            "index-progress",
            &IndexProgress {
                root_id,
                scanned: 0,
                indexed: 0,
                skipped: 0,
                current_path: String::new(),
                done: true,
            },
        );
    });
    Ok(root)
}

#[tauri::command]
pub fn remove_root(state: State<'_, AppState>, root_id: i64) -> AppResult<()> {
    state.db.with_conn(|conn| library::remove_root(conn, root_id))
}

#[tauri::command]
pub fn folder_tree(state: State<'_, AppState>, max_depth: Option<u32>) -> AppResult<Vec<FolderNode>> {
    state
        .db
        .with_conn(|conn| library::folder_tree(conn, max_depth.unwrap_or(6)))
}

#[tauri::command]
pub fn set_folder_favorite(
    state: State<'_, AppState>,
    path: String,
    favorite: bool,
) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| library::set_folder_favorite(conn, &path, favorite))
}

#[tauri::command]
pub fn reindex_root(app: AppHandle, state: State<'_, AppState>, root_id: i64) -> AppResult<()> {
    let db = state.db.clone();
    std::thread::spawn(move || {
        let _ = db.with_conn(|conn| {
            indexer::index_root(conn, root_id, |progress| {
                let _ = app.emit("index-progress", &progress);
            })
        });
    });
    Ok(())
}

#[tauri::command]
pub fn reindex_all(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let db = state.db.clone();
    std::thread::spawn(move || {
        let _ = db.with_conn(|conn| {
            indexer::index_all_roots(conn, |progress| {
                let _ = app.emit("index-progress", &progress);
            })
        });
    });
    Ok(())
}
