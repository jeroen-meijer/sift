use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::audio::peaks::{self, PeakData, DEFAULT_BUCKETS};
use crate::audio::player::{OutputDeviceInfo, SamplePlayType};
use crate::db::settings;
use crate::error::{AppError, AppResult};
use crate::indexer::{self, IndexProgress};
use crate::library::{self, FolderNode, RootDto};
use crate::samples::{self, Query as SampleQuery, SampleDto};
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

#[tauri::command]
pub fn list_samples(state: State<'_, AppState>, query: SampleQuery) -> AppResult<Vec<SampleDto>> {
    state.db.with_conn(|conn| samples::list_samples(conn, &query))
}

#[tauri::command]
pub fn set_sample_favorite(
    state: State<'_, AppState>,
    id: i64,
    favorite: bool,
) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| samples::set_sample_favorite(conn, id, favorite))
}

#[tauri::command]
pub fn get_peaks(state: State<'_, AppState>, sample_id: i64) -> AppResult<PeakData> {
    let sample = state
        .db
        .with_conn(|conn| samples::get_sample(conn, sample_id))?
        .ok_or_else(|| AppError::msg("sample not found"))?;
    let path = Path::new(&sample.path);
    // Fill technical metadata when missing (first waveform request).
    if sample.sample_rate.is_none() || sample.duration_ms.is_none() {
        let _ = state
            .db
            .with_conn(|conn| crate::audio::probe_and_update_sample(conn, sample_id, path));
    }
    peaks::ensure_peaks(&state.paths, sample_id, path, DEFAULT_BUCKETS)
}

#[tauri::command]
pub fn play_sample(
    state: State<'_, AppState>,
    sample_id: i64,
    start_secs: Option<f64>,
) -> AppResult<()> {
    let sample = state
        .db
        .with_conn(|conn| samples::get_sample(conn, sample_id))?
        .ok_or_else(|| AppError::msg("sample not found"))?;
    if sample.missing {
        return Err(AppError::msg("sample file is missing"));
    }
    let play_type = SamplePlayType::from_str_opt(sample.sample_type.as_deref());
    let mut player = state.player.lock().expect("player lock");
    player.play_file(
        Path::new(&sample.path),
        start_secs.unwrap_or(0.0),
        play_type,
    )
}

#[tauri::command]
pub fn stop_playback(state: State<'_, AppState>) -> AppResult<()> {
    state.player.lock().expect("player lock").stop();
    Ok(())
}

#[tauri::command]
pub fn pause_playback(state: State<'_, AppState>) -> AppResult<()> {
    state.player.lock().expect("player lock").pause();
    Ok(())
}

#[tauri::command]
pub fn resume_playback(state: State<'_, AppState>) -> AppResult<()> {
    state.player.lock().expect("player lock").resume()
}

#[tauri::command]
pub fn list_output_devices(state: State<'_, AppState>) -> AppResult<Vec<OutputDeviceInfo>> {
    state.player.lock().expect("player lock").list_devices()
}

#[tauri::command]
pub fn set_output_device(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state
        .player
        .lock()
        .expect("player lock")
        .set_device(&id)?;
    state
        .db
        .with_conn(|conn| settings::set(conn, "output_device", &json!(id)))
}

#[tauri::command]
pub fn set_preview_gain(state: State<'_, AppState>, db: f64) -> AppResult<()> {
    state
        .player
        .lock()
        .expect("player lock")
        .set_gain_db(db as f32);
    state
        .db
        .with_conn(|conn| settings::set(conn, "preview_gain_db", &json!(db)))
}

#[tauri::command]
pub fn set_loop_preview(state: State<'_, AppState>, on: bool) -> AppResult<()> {
    state
        .player
        .lock()
        .expect("player lock")
        .set_loop_preview(on);
    state
        .db
        .with_conn(|conn| settings::set(conn, "loop_preview", &json!(on)))
}
