use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State, Window};

use crate::audio::jit;
use crate::audio::peaks::{self, PeakData, DEFAULT_BUCKETS};
use crate::audio::player::{OutputDeviceInfo, SamplePlayType};
use crate::db::settings;
use crate::error::{AppError, AppResult};
use crate::indexer::{self, IndexProgress};
use crate::library::{self, FolderNode, RootDto};
use crate::samples::{self, Query as SampleQuery, SampleDto};
use crate::state::AppState;
use crate::tags::{self, TagNode};
use crate::undo::UndoAction;
use crate::watch;

#[derive(serde::Serialize)]
pub struct DbStats {
    pub roots: i64,
    pub samples: i64,
    pub tags: i64,
    pub data_dir: String,
    pub clips_dir: String,
}

fn restart_watches(app: &AppHandle, state: &AppState) {
    watch::restart(app, &state.watch_shared, &state.watch_guard);
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
    restart_watches(&app, &state);
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
        crate::analyze::enqueue_unanalyzed(app, db);
    });
    Ok(root)
}

#[tauri::command]
pub fn remove_root(app: AppHandle, state: State<'_, AppState>, root_id: i64) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| library::remove_root(conn, root_id))?;
    restart_watches(&app, &state);
    Ok(())
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
        crate::analyze::enqueue_unanalyzed(app, db);
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
        crate::analyze::enqueue_unanalyzed(app, db);
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
    let before = state.db.with_conn(|conn| {
        let (fav, _, _, _) = samples::sample_meta_snapshot(conn, id)?;
        Ok(fav)
    })?;
    state
        .db
        .with_conn(|conn| samples::set_sample_favorite(conn, id, favorite))?;
    if before != favorite {
        state.undo.lock().expect("undo lock").push(UndoAction::Favorite {
            id,
            before,
            after: favorite,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn set_sample_bpm(
    state: State<'_, AppState>,
    id: i64,
    bpm: Option<f64>,
) -> AppResult<()> {
    let before = state.db.with_conn(|conn| {
        let (_, b, _, _) = samples::sample_meta_snapshot(conn, id)?;
        Ok(b)
    })?;
    state
        .db
        .with_conn(|conn| samples::set_sample_bpm(conn, id, bpm))?;
    if before != bpm {
        state.undo.lock().expect("undo lock").push(UndoAction::Bpm {
            id,
            before,
            after: bpm,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn set_sample_key(
    state: State<'_, AppState>,
    id: i64,
    key: Option<String>,
) -> AppResult<()> {
    let before = state.db.with_conn(|conn| {
        let (_, _, k, _) = samples::sample_meta_snapshot(conn, id)?;
        Ok(k)
    })?;
    state
        .db
        .with_conn(|conn| samples::set_sample_key(conn, id, key.as_deref()))?;
    if before != key {
        state.undo.lock().expect("undo lock").push(UndoAction::Key {
            id,
            before,
            after: key,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn set_sample_type(
    state: State<'_, AppState>,
    id: i64,
    sample_type: Option<String>,
) -> AppResult<()> {
    let before = state.db.with_conn(|conn| {
        let (_, _, _, t) = samples::sample_meta_snapshot(conn, id)?;
        Ok(t)
    })?;
    state
        .db
        .with_conn(|conn| samples::set_sample_type(conn, id, sample_type.as_deref()))?;
    if before != sample_type {
        state
            .undo
            .lock()
            .expect("undo lock")
            .push(UndoAction::SampleType {
                id,
                before,
                after: sample_type,
            });
    }
    Ok(())
}

#[tauri::command]
pub fn reanalyze_samples(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> AppResult<u64> {
    let n = ids.len() as u64;
    crate::analyze::spawn_analysis_batch(
        app,
        state.db.clone(),
        ids,
        crate::analyze::AnalyzeMode::Normal,
    );
    Ok(n)
}

#[tauri::command]
pub fn analyze_samples(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<i64>,
    custom: Option<crate::analyze::CustomOpts>,
) -> AppResult<u64> {
    let n = ids.len() as u64;
    let mode = match custom {
        Some(opts) => crate::analyze::AnalyzeMode::Custom(opts),
        None => crate::analyze::AnalyzeMode::Normal,
    };
    crate::analyze::spawn_analysis_batch(
        app,
        state.db.clone(),
        ids,
        mode,
    );
    Ok(n)
}

#[tauri::command]
pub fn purge_missing(state: State<'_, AppState>) -> AppResult<u64> {
    state.db.with_conn(samples::purge_missing)
}

#[tauri::command]
pub fn remove_sample(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db.with_conn(|conn| samples::remove_sample(conn, id))
}

#[tauri::command]
pub fn respond_ask_index(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    index: bool,
) -> AppResult<u64> {
    if index {
        let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let n = state
            .db
            .with_conn(|conn| indexer::index_paths(conn, &path_bufs))?;
        if n > 0 {
            let _ = app.emit(
                "library-changed",
                watch::LibraryChangedPayload {
                    reason: "ask-index".into(),
                },
            );
            crate::analyze::enqueue_unanalyzed(
                app,
                state.db.clone(),
            );
        }
        Ok(n)
    } else {
        let mut skip = state.watch_shared.skip_paths.lock().expect("skip lock");
        for p in paths {
            skip.insert(p);
        }
        Ok(0)
    }
}

#[tauri::command]
pub fn undo_meta(state: State<'_, AppState>) -> AppResult<bool> {
    let mut stack = state.undo.lock().expect("undo lock");
    let action = state.db.with_conn(|conn| stack.undo(conn))?;
    Ok(action.is_some())
}

#[tauri::command]
pub fn redo_meta(state: State<'_, AppState>) -> AppResult<bool> {
    let mut stack = state.undo.lock().expect("undo lock");
    let action = state.db.with_conn(|conn| stack.redo(conn))?;
    Ok(action.is_some())
}

#[tauri::command]
pub fn get_peaks(state: State<'_, AppState>, sample_id: i64) -> AppResult<PeakData> {
    let sample = state
        .db
        .with_conn(|conn| samples::get_sample(conn, sample_id))?
        .ok_or_else(|| AppError::msg("sample not found"))?;
    let path = Path::new(&sample.path);
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

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> AppResult<Vec<TagNode>> {
    state.db.with_conn(tags::list_tags)
}

#[tauri::command]
pub fn create_tag(
    state: State<'_, AppState>,
    path: String,
    color: Option<String>,
) -> AppResult<TagNode> {
    state
        .db
        .with_conn(|conn| tags::create_tag(conn, &path, color.as_deref()))
}

#[tauri::command]
pub fn rename_tag(state: State<'_, AppState>, id: i64, name: String) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| tags::rename_tag(conn, id, &name))
}

#[tauri::command]
pub fn move_tag(
    state: State<'_, AppState>,
    id: i64,
    new_parent_id: Option<i64>,
) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| tags::move_tag(conn, id, new_parent_id))
}

#[tauri::command]
pub fn set_tag_color(
    state: State<'_, AppState>,
    id: i64,
    color: Option<String>,
) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| tags::set_tag_color(conn, id, color.as_deref()))
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: i64, cascade: bool) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| tags::delete_tag(conn, id, cascade))
}

#[tauri::command]
pub fn set_sample_tags(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_ids: Vec<i64>,
) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| tags::set_sample_tags(conn, sample_id, &tag_ids))
}

#[tauri::command]
pub fn add_sample_tag(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_id: i64,
) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| tags::add_sample_tag(conn, sample_id, tag_id))?;
    state
        .undo
        .lock()
        .expect("undo lock")
        .push(UndoAction::TagAdd { sample_id, tag_id });
    Ok(())
}

#[tauri::command]
pub fn remove_sample_tag(
    state: State<'_, AppState>,
    sample_id: i64,
    tag_id: i64,
) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| tags::remove_sample_tag(conn, sample_id, tag_id))?;
    state
        .undo
        .lock()
        .expect("undo lock")
        .push(UndoAction::TagRemove { sample_id, tag_id });
    Ok(())
}

#[tauri::command]
pub fn render_jit_clip(
    state: State<'_, AppState>,
    sample_id: i64,
    start_secs: f64,
    end_secs: f64,
) -> AppResult<String> {
    let sample = state
        .db
        .with_conn(|conn| samples::get_sample(conn, sample_id))?
        .ok_or_else(|| AppError::msg("sample not found"))?;
    if sample.missing {
        return Err(AppError::msg("sample file is missing"));
    }
    let out = jit::allocate_clip_path(
        &state.paths.clips_dir,
        &sample.filename,
        start_secs,
        end_secs,
    );
    jit::render_clip(Path::new(&sample.path), start_secs, end_secs, &out)?;
    Ok(out.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn clear_jit_cache(state: State<'_, AppState>) -> AppResult<()> {
    jit::clear_cache(&state.paths.clips_dir)
}

#[tauri::command]
pub async fn start_drag_files(
    app: AppHandle,
    window: Window,
    paths: Vec<String>,
) -> AppResult<()> {
    if paths.is_empty() {
        return Err(AppError::msg("no paths to drag"));
    }
    let files: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    for path in &files {
        if !path.is_absolute() {
            return Err(AppError::msg(format!(
                "drag path must be absolute: {}",
                path.display()
            )));
        }
        if !path.exists() {
            return Err(AppError::msg(format!("drag path missing: {}", path.display())));
        }
    }

    let (tx, rx) = channel();
    let icon = drag::Image::Raw(include_bytes!("../../icons/32x32.png").to_vec());
    app.run_on_main_thread(move || {
        #[cfg(target_os = "linux")]
        let raw_window = window.gtk_window();
        #[cfg(not(target_os = "linux"))]
        let raw_window = tauri::Result::Ok(window);

        let result = match raw_window {
            Ok(w) => drag::start_drag(
                &w,
                drag::DragItem::Files(files),
                icon,
                |_result, _cursor| {},
                drag::Options {
                    mode: drag::DragMode::Copy,
                    skip_animatation_on_cancel_or_failure: false,
                },
            )
            .map_err(|e| AppError::msg(e.to_string())),
            Err(e) => Err(AppError::msg(e.to_string())),
        };
        let _ = tx.send(result);
    })
    .map_err(|e| AppError::msg(e.to_string()))?;

    rx.recv()
        .map_err(|e| AppError::msg(e.to_string()))?
}
