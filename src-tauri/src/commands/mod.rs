use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::channel;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, Window};

use crate::audio::peaks::{self, DEFAULT_BUCKETS, PeakData};
use crate::audio::player::{OutputDeviceInfo, SamplePlayType};
use crate::audio::{decode_cache, jit};
use crate::db::settings;
use crate::error::{AppError, AppResult};
use crate::indexer::{self, IndexProgress};
use crate::library::{self, FolderNode, RootDto};
use crate::samples::{self, Query as SampleQuery, SampleDto};
use crate::state::AppState;
use crate::tags::{self, TagNode};
use crate::undo::UndoAction;
use crate::watch;

/// Indeterminate work-bar ticks while walking a root. The caller finishes the
/// bar once the whole index job returns (so multi-root reindex does not flicker).
fn tick_index_progress(app: &AppHandle, progress: &IndexProgress) {
    if progress.done {
        return;
    }
    crate::analyze::work::tick(app, progress.scanned, 0, 0);
}

#[derive(serde::Serialize)]
pub struct DbStats {
    pub roots: i64,
    pub samples: i64,
    pub missing: i64,
    pub tags: i64,
    pub data_dir: String,
    pub clips_dir: String,
    pub clips_bytes: u64,
}

/// Run blocking command work on Tauri's blocking pool, never the main thread.
///
/// Sync Tauri commands run on the app main thread, which also runs `AppKit`
/// input and the `WebView` host. Every command that touches the DB, the disk
/// or a decoder goes through here.
async fn off_main<T, F>(app: AppHandle, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<AppState>()))
        .await
        .map_err(|e| AppError::msg(format!("blocking task failed: {e}")))?
}

/// Longest the detail pane waits for its sample to be analyzed.
const DETAIL_PEAKS_WAIT: std::time::Duration = std::time::Duration::from_secs(15);

/// True when `seq` is still the newest play/stop request.
fn is_current_play(latest: &AtomicU64, seq: u64) -> bool {
    latest.load(Ordering::SeqCst) == seq
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> AppResult<Value> {
    off_main(app, move |state| state.db.with_conn(settings::get_all)).await
}

#[tauri::command]
pub async fn set_setting(app: AppHandle, key: String, value: Value) -> AppResult<()> {
    off_main(app.clone(), move |state| {
        let turning_splice_on = key == "splice_enabled" && value.as_bool() == Some(true);
        state.db.with_conn(|conn| settings::set(conn, &key, &value))?;
        if turning_splice_on {
            let status = crate::splice::refresh_catalog_status();
            if let Some(path) = status.path.as_ref() {
                let _ = state.db.with_conn(|conn| {
                    settings::set(conn, "splice_db_path", &Value::String(path.clone()))
                });
            }
            let n = crate::analyze::refresh_metadata_all(&app, &state.db).unwrap_or(0);
            let _ = n; // library-changed is emitted inside refresh when rows change
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn db_stats(app: AppHandle) -> AppResult<DbStats> {
    off_main(app, move |state| {
        state.db.with_conn(|conn| {
            use crate::db::schema::roots::dsl as roots_dsl;
            use crate::db::schema::samples::dsl as samples_dsl;
            use crate::db::schema::tags::dsl as tags_dsl;
            use diesel::dsl::count_star;
            use diesel::prelude::*;

            let roots: i64 = roots_dsl::roots.select(count_star()).first(conn)?;
            let samples: i64 = samples_dsl::samples.select(count_star()).first(conn)?;
            let missing: i64 = samples_dsl::samples
                .filter(samples_dsl::missing.ne(0))
                .select(count_star())
                .first(conn)?;
            let tags: i64 = tags_dsl::tags.select(count_star()).first(conn)?;
            let clips_dir = state.clips_dir();
            Ok(DbStats {
                roots,
                samples,
                missing,
                tags,
                data_dir: state.paths.data_dir.to_string_lossy().into_owned(),
                clips_bytes: jit::cache_size(&clips_dir),
                clips_dir: clips_dir.to_string_lossy().into_owned(),
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn list_roots(app: AppHandle) -> AppResult<Vec<RootDto>> {
    off_main(app, move |state| state.db.with_conn(library::list_roots)).await
}

#[tauri::command]
pub async fn add_root(app: AppHandle, path: String) -> AppResult<RootDto> {
    off_main(app.clone(), move |state| {
        let total = std::time::Instant::now();
        let root = state.db.with_conn(|conn| library::add_root(conn, &path))?;
        let root_id = root.id;
        let db = state.db.clone();
        // Do not block IPC on recursive FSEvents registration.
        let watch_app = app.clone();
        let watch_shared = state.watch_shared.clone();
        let watch_guard = Arc::clone(&state.watch_guard);
        std::thread::spawn(move || {
            watch::restart(&watch_app, &watch_shared, &watch_guard);
        });
        crate::profile_log::event("ipc.add_root", total.elapsed(), &format!("id={root_id}"));
        let index_app = app;
        let peaks_dir = state.paths.peaks_dir.clone();
        let _ = std::thread::Builder::new()
            .name("sift-index-root".into())
            .spawn(move || {
                let _ = qos_threads::set_current_thread(qos_threads::Qos::Low);
                let index_start = std::time::Instant::now();
                crate::analyze::work::start(&index_app, 0);
                let scanned = db
                    .with_conn(|conn| {
                        indexer::index_root(conn, root_id, |progress| {
                            tick_index_progress(&index_app, &progress);
                        })
                    })
                    .map_or(0, |p| p.scanned);
                crate::analyze::work::finish(&index_app, scanned);
                index_app.state::<crate::state::AppState>().changes.push(
                    &index_app,
                    "index",
                    true,
                    &[],
                );
                crate::profile_log::event(
                    "index.root_done",
                    index_start.elapsed(),
                    &format!("id={root_id}"),
                );
                crate::analyze::enqueue_unanalyzed(index_app, db, peaks_dir);
            });
        Ok(root)
    })
    .await
}

#[tauri::command]
pub async fn remove_root(app: AppHandle, root_id: i64) -> AppResult<()> {
    off_main(app.clone(), move |state| {
        state
            .db
            .with_conn(|conn| library::remove_root(conn, root_id))?;
        // Recursive FSEvents registration can take seconds on big roots.
        let watch_shared = state.watch_shared.clone();
        let watch_guard = Arc::clone(&state.watch_guard);
        std::thread::spawn(move || {
            watch::restart(&app, &watch_shared, &watch_guard);
        });
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn folder_tree(app: AppHandle, max_depth: Option<u32>) -> AppResult<Vec<FolderNode>> {
    off_main(app, move |state| {
        let depth = max_depth.unwrap_or(6);
        crate::profile_log::time("ipc.folder_tree", &format!("depth={depth}"), || {
            state.db.with_conn(|conn| library::folder_tree(conn, depth))
        })
    })
    .await
}

#[tauri::command]
pub async fn set_folder_favorite(app: AppHandle, path: String, favorite: bool) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .db
            .with_conn(|conn| library::set_folder_favorite(conn, &path, favorite))
    })
    .await
}

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "Tauri command: keep the Result IPC shape stable"
)]
pub async fn reindex_root(app: AppHandle, root_id: i64) -> AppResult<()> {
    off_main(app.clone(), move |state| {
        let db = state.db.clone();
        let peaks_dir = state.paths.peaks_dir.clone();
        let _ = std::thread::Builder::new()
            .name("sift-reindex-root".into())
            .spawn(move || {
                let _ = qos_threads::set_current_thread(qos_threads::Qos::Low);
                crate::analyze::work::start(&app, 0);
                let scanned = db
                    .with_conn(|conn| {
                        indexer::index_root(conn, root_id, |progress| {
                            tick_index_progress(&app, &progress);
                        })
                    })
                    .map_or(0, |p| p.scanned);
                crate::analyze::work::finish(&app, scanned);
                app.state::<crate::state::AppState>()
                    .changes
                    .push(&app, "index", true, &[]);
                crate::analyze::enqueue_unanalyzed(app, db, peaks_dir);
            });
        Ok(())
    })
    .await
}

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "Tauri command: keep the Result IPC shape stable"
)]
pub async fn reindex_all(app: AppHandle) -> AppResult<()> {
    off_main(app.clone(), move |state| {
        let db = state.db.clone();
        let peaks_dir = state.paths.peaks_dir.clone();
        let _ = std::thread::Builder::new()
            .name("sift-reindex-all".into())
            .spawn(move || {
                let _ = qos_threads::set_current_thread(qos_threads::Qos::Low);
                crate::analyze::work::start(&app, 0);
                let mut scanned = 0u64;
                let _ = db.with_conn(|conn| {
                    indexer::index_all_roots(conn, |progress| {
                        tick_index_progress(&app, &progress);
                        if progress.done {
                            scanned = scanned.saturating_add(progress.scanned);
                        }
                    })
                });
                crate::analyze::work::finish(&app, scanned);
                app.state::<crate::state::AppState>()
                    .changes
                    .push(&app, "index", true, &[]);
                crate::analyze::enqueue_unanalyzed(app, db, peaks_dir);
            });
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_samples(app: AppHandle, query: SampleQuery) -> AppResult<Vec<SampleDto>> {
    off_main(app, move |state| {
        let start = std::time::Instant::now();
        let rows = state
            .db
            .with_conn(|conn| samples::list_samples(conn, &query))?;
        crate::profile_log::event(
            "ipc.list_samples",
            start.elapsed(),
            &format!(
                "n={} folder={:?} text={:?} tags={} fav={}",
                rows.len(),
                query.folder_prefix.as_deref().unwrap_or(""),
                query.text.as_deref().unwrap_or(""),
                query.tag_paths.len(),
                query.favorites_only
            ),
        );
        Ok(rows)
    })
    .await
}

/// Fresh rows for the given ids, so the UI can patch rows after a change
/// instead of refetching the whole list.
#[tauri::command]
pub async fn get_samples(app: AppHandle, ids: Vec<i64>) -> AppResult<Vec<SampleDto>> {
    off_main(app, move |state| {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        crate::profile_log::time("ipc.get_samples", &format!("n={}", ids.len()), || {
            state.db.with_conn(|conn| samples::get_samples(conn, &ids))
        })
    })
    .await
}

#[tauri::command]
pub async fn set_sample_favorite(app: AppHandle, id: i64, favorite: bool) -> AppResult<()> {
    off_main(app, move |state| {
        // Hold the undo lock for the whole read, write and push so two quick
        // edits cannot interleave now that commands run concurrently.
        // Lock order everywhere: undo, then DB.
        let mut undo = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let before = state.db.with_conn(|conn| {
            let (fav, _, _, _) = samples::sample_meta_snapshot(conn, id)?;
            Ok(fav)
        })?;
        state
            .db
            .with_conn(|conn| samples::set_sample_favorite(conn, id, favorite))?;
        if before != favorite {
            undo.push(UndoAction::Favorite {
                id,
                before,
                after: favorite,
            });
        }
        drop(undo);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_sample_bpm(app: AppHandle, id: i64, bpm: Option<f64>) -> AppResult<()> {
    off_main(app, move |state| {
        // Hold the undo lock for the whole read, write and push so two quick
        // edits cannot interleave now that commands run concurrently.
        // Lock order everywhere: undo, then DB.
        let mut undo = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let before = state.db.with_conn(|conn| {
            let (_, b, _, _) = samples::sample_meta_snapshot(conn, id)?;
            Ok(b)
        })?;
        state
            .db
            .with_conn(|conn| samples::set_sample_bpm(conn, id, bpm))?;
        if before != bpm {
            undo.push(UndoAction::Bpm {
                id,
                before,
                after: bpm,
            });
        }
        drop(undo);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_sample_key(app: AppHandle, id: i64, key: Option<String>) -> AppResult<()> {
    off_main(app, move |state| {
        // Hold the undo lock for the whole read, write and push so two quick
        // edits cannot interleave now that commands run concurrently.
        // Lock order everywhere: undo, then DB.
        let mut undo = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let before = state.db.with_conn(|conn| {
            let (_, _, k, _) = samples::sample_meta_snapshot(conn, id)?;
            Ok(k)
        })?;
        state
            .db
            .with_conn(|conn| samples::set_sample_key(conn, id, key.as_deref()))?;
        if before != key {
            undo.push(UndoAction::Key {
                id,
                before,
                after: key,
            });
        }
        drop(undo);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_sample_type(
    app: AppHandle,
    id: i64,
    sample_type: Option<String>,
) -> AppResult<()> {
    off_main(app, move |state| {
        // Hold the undo lock for the whole read, write and push so two quick
        // edits cannot interleave now that commands run concurrently.
        // Lock order everywhere: undo, then DB.
        let mut undo = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let before = state.db.with_conn(|conn| {
            let (_, _, _, t) = samples::sample_meta_snapshot(conn, id)?;
            Ok(t)
        })?;
        state
            .db
            .with_conn(|conn| samples::set_sample_type(conn, id, sample_type.as_deref()))?;
        if before != sample_type {
            undo.push(UndoAction::SampleType {
                id,
                before,
                after: sample_type,
            });
        }
        drop(undo);
        Ok(())
    })
    .await
}

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "Tauri command: keep the Result IPC shape stable"
)]
pub async fn reanalyze_samples(app: AppHandle, ids: Vec<i64>) -> AppResult<u64> {
    off_main(app.clone(), move |state| {
        let n = u64::try_from(ids.len()).unwrap_or(u64::MAX);
        crate::analyze::spawn_analysis_batch(
            app,
            state.db.clone(),
            state.paths.peaks_dir.clone(),
            ids,
            crate::analyze::AnalyzeMode::Normal,
        );
        Ok(n)
    })
    .await
}

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "Tauri command: keep the Result IPC shape stable"
)]
pub async fn analyze_samples(
    app: AppHandle,
    ids: Vec<i64>,
    custom: Option<crate::analyze::CustomOpts>,
) -> AppResult<u64> {
    off_main(app.clone(), move |state| {
        let n = u64::try_from(ids.len()).unwrap_or(u64::MAX);
        let mode = custom.map_or(
            crate::analyze::AnalyzeMode::Normal,
            crate::analyze::AnalyzeMode::Custom,
        );
        crate::analyze::spawn_analysis_batch(
            app,
            state.db.clone(),
            state.paths.peaks_dir.clone(),
            ids,
            mode,
        );
        Ok(n)
    })
    .await
}

#[tauri::command]
pub async fn splice_catalog_status(app: AppHandle) -> AppResult<crate::splice::CatalogStatus> {
    off_main(app, move |_state| Ok(crate::splice::refresh_catalog_status())).await
}

#[tauri::command]
pub async fn refresh_metadata(app: AppHandle) -> AppResult<u64> {
    off_main(app.clone(), move |state| {
        crate::analyze::refresh_metadata_all(&app, &state.db)
    })
    .await
}

#[tauri::command]
pub async fn reanalyze_entire_library(app: AppHandle) -> AppResult<u64> {
    off_main(app.clone(), move |state| {
        let peaks_dir = state.paths.peaks_dir.clone();
        let ids = state
            .db
            .with_conn(|conn| samples::wipe_analysis_all(conn, &peaks_dir))?;
        let n = u64::try_from(ids.len()).unwrap_or(u64::MAX);
        if !ids.is_empty() {
            crate::analyze::spawn_analysis_batch(
                app.clone(),
                state.db.clone(),
                peaks_dir,
                ids,
                crate::analyze::AnalyzeMode::Normal,
            );
        }
        state
            .changes
            .push(&app, "reanalyze-library", true, &[]);
        Ok(n)
    })
    .await
}

#[tauri::command]
pub async fn purge_missing(app: AppHandle) -> AppResult<u64> {
    off_main(app, move |state| state.db.with_conn(samples::purge_missing)).await
}

#[tauri::command]
pub async fn remove_sample(app: AppHandle, id: i64) -> AppResult<()> {
    off_main(app, move |state| {
        state.db.with_conn(|conn| samples::remove_sample(conn, id))
    })
    .await
}

#[tauri::command]
pub async fn respond_ask_index(app: AppHandle, paths: Vec<String>, index: bool) -> AppResult<u64> {
    off_main(app.clone(), move |state| {
        if index {
            let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
            let total = u64::try_from(path_bufs.len()).unwrap_or(u64::MAX);
            crate::analyze::work::start(&app, total);
            let n = state
                .db
                .with_conn(|conn| indexer::index_paths(conn, &path_bufs))?;
            crate::analyze::work::finish(&app, n);
            if n > 0 {
                state.changes.push(&app, "ask-index", true, &[]);
                crate::analyze::enqueue_unanalyzed(
                    app,
                    state.db.clone(),
                    state.paths.peaks_dir.clone(),
                );
            }
            Ok(n)
        } else {
            {
                let mut skip = state
                    .watch_shared
                    .skip_paths
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                for p in paths {
                    skip.insert(p);
                }
            }
            Ok(0)
        }
    })
    .await
}

#[tauri::command]
pub async fn undo_meta(app: AppHandle) -> AppResult<bool> {
    off_main(app, move |state| {
        let mut stack = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let action = state.db.with_conn(|conn| stack.undo(conn))?;
        Ok(action.is_some())
    })
    .await
}

#[tauri::command]
pub async fn redo_meta(app: AppHandle) -> AppResult<bool> {
    off_main(app, move |state| {
        let mut stack = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let action = state.db.with_conn(|conn| stack.redo(conn))?;
        Ok(action.is_some())
    })
    .await
}

#[tauri::command]
pub async fn refresh_sample_availability(app: AppHandle, paths: Vec<String>) -> AppResult<u64> {
    off_main(app.clone(), move |state| {
        if paths.is_empty() {
            return Ok(0);
        }
        let result = samples::refresh_availability_for_paths(&state.db, &paths)?;
        if !result.became_local_ids.is_empty() {
            crate::analyze::enqueue_ids(
                app,
                state.db.clone(),
                state.paths.peaks_dir.clone(),
                result.became_local_ids,
            );
        }
        Ok(result.updated)
    })
    .await
}

#[tauri::command]
pub async fn get_peaks(app: AppHandle, sample_id: i64, wait: Option<bool>) -> AppResult<PeakData> {
    off_main(app.clone(), move |state| {
        crate::profile_log::time("ipc.get_peaks", &format!("id={sample_id}"), || {
            let sample = state
                .db
                .with_conn(|conn| samples::get_sample(conn, sample_id))?
                .ok_or_else(|| AppError::msg("sample not found"))?;
            if sample.missing || sample.availability != "local" {
                // Empty placeholder. Never decode cloud stubs on the interactive path.
                return Ok(peaks::empty_peaks(DEFAULT_BUCKETS));
            }
            if let Some(data) = peaks::read_cached_peaks(&state.paths.peaks_dir, sample_id)? {
                return Ok(data);
            }
            // No peakfile yet. Browsing never decodes by itself: all decode work
            // goes through the analyze queue, so the status bar always shows it.
            let db = state.db.clone();
            let peaks_dir = state.paths.peaks_dir.clone();
            if wait.unwrap_or(false) {
                // The detail pane: analyze this one first and wait for it.
                crate::analyze::analyze_now(app, db, peaks_dir, sample_id, DETAIL_PEAKS_WAIT);
                if let Some(data) = peaks::read_cached_peaks(&state.paths.peaks_dir, sample_id)? {
                    return Ok(data);
                }
            } else {
                // A row: jump the queue, show a placeholder until the analyze
                // finish event arrives.
                crate::analyze::enqueue_priority(app, db, peaks_dir, vec![sample_id]);
            }
            Ok(peaks::not_ready_peaks())
        })
    })
    .await
}

#[tauri::command]
pub async fn play_sample(
    app: AppHandle,
    sample_id: i64,
    seq: u64,
    start_secs: Option<f64>,
    region_start_secs: Option<f64>,
    region_end_secs: Option<f64>,
) -> AppResult<()> {
    off_main(app, move |state| {
        let total = std::time::Instant::now();
        state.play_seq.fetch_max(seq, Ordering::SeqCst);
        let sample = state
            .db
            .with_conn(|conn| samples::get_sample(conn, sample_id))?
            .ok_or_else(|| AppError::msg("sample not found"))?;
        if sample.missing {
            return Err(AppError::msg("sample file is missing"));
        }
        if sample.availability != "local" {
            return Err(AppError::msg(
                "sample is online-only; download it before playing",
            ));
        }
        let path = Path::new(&sample.path);
        let play_type = SamplePlayType::from_str_opt(sample.sample_type.as_deref());
        let region = region_start_secs
            .zip(region_end_secs)
            .filter(|(a, b)| b > a);
        let start = start_secs.or(region_start_secs).unwrap_or(0.0);

        let decode_start = std::time::Instant::now();
        let (decoded, cache_hit) = decode_cache::get_or_decode(&state.decode_cache, path)?;
        crate::profile_log::event(
            if cache_hit {
                "play.decode_cache_hit"
            } else {
                "play.decode"
            },
            decode_start.elapsed(),
            &format!("id={sample_id}"),
        );

        // A newer play or a stop arrived while this one decoded: drop it.
        if !is_current_play(&state.play_seq, seq) {
            crate::profile_log::event(
                "play.superseded",
                total.elapsed(),
                &format!("id={sample_id} seq={seq}"),
            );
            return Ok(());
        }
        state
            .player
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .play_decoded(path, &decoded, start, play_type, region)?;

        crate::profile_log::event(
            "ipc.play_sample",
            total.elapsed(),
            &format!("id={sample_id}"),
        );
        Ok(())
    })
    .await
}

/// Longest sample `prefetch_decode` will decode ahead of time. Longer files
/// cost too much memory and CPU for a guess about what plays next.
const PREFETCH_MAX_DURATION_MS: f64 = 30_000.0;

/// Warm the decode LRU for upcoming select→play (neighbors / hover).
#[tauri::command]
pub async fn prefetch_decode(app: AppHandle, sample_ids: Vec<i64>) -> AppResult<()> {
    off_main(app, move |state| {
        if sample_ids.is_empty() {
            return Ok(());
        }
        let mut paths = Vec::with_capacity(sample_ids.len());
        state.db.with_conn(|conn| {
            for id in sample_ids {
                if let Some(sample) = samples::get_sample(conn, id)?
                    && !sample.missing
                    && sample.availability == "local"
                    && sample
                        .duration_ms
                        .is_some_and(|ms| ms <= PREFETCH_MAX_DURATION_MS)
                {
                    paths.push(sample.path);
                }
            }
            Ok(())
        })?;
        for path in &paths {
            decode_cache::prefetch(&state.decode_cache, Path::new(path));
        }
        Ok(())
    })
    .await
}

/// Retune the loop window while a preview runs, so dragging a selection handle
/// changes what loops without restarting the audio.
#[tauri::command]
pub fn set_play_region(state: State<'_, AppState>, start_secs: Option<f64>, end_secs: Option<f64>) {
    let region = start_secs.zip(end_secs).filter(|(a, b)| b > a);
    state
        .player
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .set_region(region);
}

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "Tauri command: keep the Result IPC shape stable"
)]
pub fn stop_playback(state: State<'_, AppState>, seq: u64) -> AppResult<()> {
    state.play_seq.fetch_max(seq, Ordering::SeqCst);
    state
        .player
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .stop();
    Ok(())
}

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "Tauri command: keep the Result IPC shape stable"
)]
pub fn pause_playback(state: State<'_, AppState>, seq: u64) -> AppResult<()> {
    state.play_seq.fetch_max(seq, Ordering::SeqCst);
    state
        .player
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .pause();
    Ok(())
}

#[tauri::command]
pub fn resume_playback(state: State<'_, AppState>) -> AppResult<()> {
    state
        .player
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .resume()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PlaybackState {
    pub position_secs: f64,
    pub playing: bool,
}

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "Tauri command: keep the Result IPC shape stable"
)]
pub fn playback_state(state: State<'_, AppState>) -> AppResult<PlaybackState> {
    let (position_secs, playing) = state
        .player
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .playback_state();
    Ok(PlaybackState {
        position_secs,
        playing,
    })
}

#[tauri::command]
pub async fn list_output_devices(app: AppHandle) -> AppResult<Vec<OutputDeviceInfo>> {
    off_main(app, move |state| {
        state
            .player
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .list_devices()
    })
    .await
}

#[tauri::command]
pub async fn set_output_device(app: AppHandle, id: String) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .player
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .set_device(&id)?;
        state
            .db
            .with_conn(|conn| settings::set(conn, "output_device", &json!(id)))
    })
    .await
}

#[tauri::command]
pub async fn set_preview_gain(app: AppHandle, db: f64) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .player
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .set_gain_db(crate::ids::f64_to_f32(db));
        state
            .db
            .with_conn(|conn| settings::set(conn, "preview_gain_db", &json!(db)))
    })
    .await
}

#[tauri::command]
pub async fn set_loop_preview(app: AppHandle, on: bool) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .player
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .set_loop_preview(on);
        state
            .db
            .with_conn(|conn| settings::set(conn, "loop_preview", &json!(on)))
    })
    .await
}

#[tauri::command]
pub async fn list_tags(app: AppHandle) -> AppResult<Vec<TagNode>> {
    off_main(app, move |state| state.db.with_conn(tags::list_tags)).await
}

#[tauri::command]
pub async fn create_tag(app: AppHandle, path: String, color: Option<String>) -> AppResult<TagNode> {
    off_main(app, move |state| {
        state
            .db
            .with_conn(|conn| tags::create_tag(conn, &path, color.as_deref()))
    })
    .await
}

#[tauri::command]
pub async fn rename_tag(app: AppHandle, id: i64, name: String) -> AppResult<()> {
    off_main(app, move |state| {
        state.db.with_conn(|conn| tags::rename_tag(conn, id, &name))
    })
    .await
}

#[tauri::command]
pub async fn move_tag(app: AppHandle, id: i64, new_parent_id: Option<i64>) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .db
            .with_conn(|conn| tags::move_tag(conn, id, new_parent_id))
    })
    .await
}

#[tauri::command]
pub async fn set_tag_color(app: AppHandle, id: i64, color: Option<String>) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .db
            .with_conn(|conn| tags::set_tag_color(conn, id, color.as_deref()))
    })
    .await
}

#[tauri::command]
pub async fn delete_tag(app: AppHandle, id: i64, cascade: bool) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .db
            .with_conn(|conn| tags::delete_tag(conn, id, cascade))
    })
    .await
}

#[tauri::command]
pub async fn set_sample_tags(app: AppHandle, sample_id: i64, tag_ids: Vec<i64>) -> AppResult<()> {
    off_main(app, move |state| {
        state
            .db
            .with_conn(|conn| tags::set_sample_tags(conn, sample_id, &tag_ids))
    })
    .await
}

#[tauri::command]
pub async fn add_sample_tag(app: AppHandle, sample_id: i64, tag_id: i64) -> AppResult<()> {
    off_main(app, move |state| {
        // Hold the undo lock for the whole read, write and push so two quick
        // edits cannot interleave now that commands run concurrently.
        // Lock order everywhere: undo, then DB.
        let mut undo = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state
            .db
            .with_conn(|conn| tags::add_sample_tag(conn, sample_id, tag_id))?;
        undo.push(UndoAction::TagAdd { sample_id, tag_id });
        drop(undo);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn remove_sample_tag(app: AppHandle, sample_id: i64, tag_id: i64) -> AppResult<()> {
    off_main(app, move |state| {
        // Hold the undo lock for the whole read, write and push so two quick
        // edits cannot interleave now that commands run concurrently.
        // Lock order everywhere: undo, then DB.
        let mut undo = state
            .undo
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state
            .db
            .with_conn(|conn| tags::remove_sample_tag(conn, sample_id, tag_id))?;
        undo.push(UndoAction::TagRemove { sample_id, tag_id });
        drop(undo);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn render_jit_clip(
    app: AppHandle,
    sample_id: i64,
    start_secs: f64,
    end_secs: f64,
) -> AppResult<String> {
    off_main(app, move |state| {
        let sample = state
            .db
            .with_conn(|conn| samples::get_sample(conn, sample_id))?
            .ok_or_else(|| AppError::msg("sample not found"))?;
        if sample.missing {
            return Err(AppError::msg("sample file is missing"));
        }
        let out =
            jit::allocate_clip_path(&state.clips_dir(), &sample.filename, start_secs, end_secs);
        jit::render_clip(Path::new(&sample.path), start_secs, end_secs, &out)?;
        Ok(out.to_string_lossy().into_owned())
    })
    .await
}

/// Nudge each point to the nearest zero crossing (the `Z` key on the waveform).
#[tauri::command]
pub async fn snap_zero_crossings(
    app: AppHandle,
    sample_id: i64,
    points: Vec<f64>,
) -> AppResult<Vec<f64>> {
    off_main(app, move |state| {
        let sample = state
            .db
            .with_conn(|conn| samples::get_sample(conn, sample_id))?
            .ok_or_else(|| AppError::msg("sample not found"))?;
        if sample.missing {
            return Ok(points);
        }
        let audio = crate::audio::decode_file(Path::new(&sample.path))?;
        Ok(points
            .into_iter()
            .map(|secs| crate::audio::zero_cross::nearest(&audio, secs))
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn clear_jit_cache(app: AppHandle) -> AppResult<()> {
    off_main(app, move |state| jit::clear_cache(&state.clips_dir())).await
}

/// Point the JIT clip cache at another directory. The old cache is left alone.
#[tauri::command]
pub async fn set_clips_dir(app: AppHandle, path: String) -> AppResult<()> {
    off_main(app, move |state| {
        let dir = PathBuf::from(&path);
        if !dir.is_absolute() {
            return Err(AppError::msg("clip cache path must be absolute"));
        }
        std::fs::create_dir_all(&dir)?;
        state.set_clips_dir(dir);
        state
            .db
            .with_conn(|conn| settings::set(conn, "clips_dir", &json!(path)))
    })
    .await
}

/// True while `AppKit` still has the mouse event a drag session can attach to.
///
/// The drag plugin asks `AppKit` for a session and unwraps the result. If the
/// webview's `dragstart` has already finished (anything slow between the
/// gesture and this command), `AppKit` returns NULL and the plugin panics.
/// Checking first turns that crash into an ordinary error.
#[cfg(target_os = "macos")]
fn drag_gesture_is_live() -> bool {
    use objc2_app_kit::{NSApplication, NSEventType};

    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return false;
    };
    NSApplication::sharedApplication(mtm)
        .currentEvent()
        .is_some_and(|event| {
            matches!(
                event.r#type(),
                NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged
            )
        })
}

#[cfg(not(target_os = "macos"))]
const fn drag_gesture_is_live() -> bool {
    true
}

#[tauri::command]
pub async fn start_drag_files(app: AppHandle, window: Window, paths: Vec<String>) -> AppResult<()> {
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
            return Err(AppError::msg(format!(
                "drag path missing: {}",
                path.display()
            )));
        }
    }

    let (tx, rx) = channel();
    let icon = drag::Image::Raw(include_bytes!("../../icons/32x32.png").to_vec());
    app.run_on_main_thread(move || {
        #[cfg(target_os = "linux")]
        let raw_window = window.gtk_window();
        #[cfg(not(target_os = "linux"))]
        let raw_window = tauri::Result::Ok(window);

        if !drag_gesture_is_live() {
            let _ = tx.send(Err(AppError::msg("drag gesture already finished")));
            return;
        }

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

    rx.recv().map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn profile_enabled() -> bool {
    crate::profile_log::is_enabled()
}

#[tauri::command]
pub fn profile_log_path() -> Option<String> {
    crate::profile_log::log_path().map(|p| p.display().to_string())
}

#[tauri::command]
pub fn profile_mark(name: String, ms: f64, detail: Option<String>) {
    crate::profile_log::mark(&name, ms, detail.as_deref().unwrap_or(""));
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ProfileMarkDto {
    pub name: String,
    pub ms: f64,
    pub detail: Option<String>,
}

#[tauri::command]
pub fn profile_mark_batch(marks: Vec<ProfileMarkDto>) {
    for mark in marks {
        crate::profile_log::mark(&mark.name, mark.ms, mark.detail.as_deref().unwrap_or(""));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_request_supersedes_play() {
        let latest = AtomicU64::new(0);
        latest.fetch_max(3, Ordering::SeqCst);
        assert!(is_current_play(&latest, 3));
        // A stop or newer play with a higher number arrives mid-decode.
        latest.fetch_max(4, Ordering::SeqCst);
        assert!(!is_current_play(&latest, 3));
        // A late, older request never lowers the latest number.
        latest.fetch_max(2, Ordering::SeqCst);
        assert!(is_current_play(&latest, 4));
    }
}
