mod analyze;
mod audio;
mod changes;
mod commands;
mod db;
mod error;
mod fs_dates;
mod fs_ready;
mod ids;
mod indexer;
mod library;
mod meta_source;
mod paths;
mod perf_budgets;
mod profile_log;
mod samples;
mod splice;
mod state;
mod tags;
mod undo;
mod watch;

/// Hot-path APIs for Criterion benches and soft perf budget tests.
/// Not part of the Tauri IPC surface.
pub mod perf {
    pub use crate::analyze::{AnalysisInput, Analyzer, HeuristicAnalyzer, PathTokenAnalyzer};
    pub use crate::audio::decode::{DecodedAudio, decode_file, to_mono};
    pub use crate::audio::jit::render_clip;
    pub use crate::audio::peaks::{DEFAULT_BUCKETS, generate_peaks};
}

use state::AppState;
use std::sync::Arc;
use std::time::Instant;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// Tauri entry: `generate_context!` expands to a `process::exit`, and init failures
// are unrecoverable, so this is the one place that may panic.
#[allow(clippy::expect_used, clippy::panic, clippy::exit)]
pub fn run() {
    crate::profile_log::note_boot();
    crate::profile_log::milestone("boot.run_enter", "");

    let state_start = Instant::now();
    let app_state = AppState::init().expect("failed to initialize Sift app state");
    crate::profile_log::event("boot.app_state_init", state_start.elapsed(), "");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .setup(|app| {
            let setup_start = Instant::now();
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            crate::profile_log::init(&state.paths.cache_dir);
            crate::profile_log::milestone("boot.setup_enter", "");

            // Recursive watches stay off the setup path (same as add/remove root).
            watch::restart_in_background(
                handle.clone(),
                state.watch_shared.clone(),
                Arc::clone(&state.watch_guard),
            );

            // Backfill availability from live metadata, then resume analyze for locals.
            let db = state.db.clone();
            let peaks_dir = state.paths.peaks_dir.clone();
            let changes = Arc::clone(&state.changes);
            let _ = std::thread::Builder::new()
                .name("sift-avail-backfill".into())
                .spawn(move || {
                    let _ = qos_threads::set_current_thread(qos_threads::Qos::Low);
                    let start = Instant::now();
                    let refresh = crate::samples::refresh_availability_all(&db, Some(&handle))
                        .unwrap_or_default();
                    crate::profile_log::event(
                        "avail.library_refresh",
                        start.elapsed(),
                        &format!(
                            "updated={} dates_filled={} became_local={}",
                            refresh.updated,
                            refresh.dates_filled,
                            refresh.became_local_ids.len()
                        ),
                    );
                    if refresh.updated > 0 || refresh.dates_filled > 0 {
                        // Date backfill and non-local flips need a full list reload;
                        // became-local-only can patch by id.
                        let only_became_local = refresh.dates_filled == 0
                            && u64::try_from(refresh.became_local_ids.len()).ok()
                                == Some(refresh.updated);
                        changes.push(
                            &handle,
                            "availability",
                            !only_became_local,
                            &refresh.became_local_ids,
                        );
                    }
                    crate::analyze::enqueue_unanalyzed(handle, db, peaks_dir);
                });
            // Window starts hidden (tauri.conf `visible: false`). Frontend shows it
            // once settings and library stats are known. Failsafe if that never runs.
            let reveal = app.handle().clone();
            let _ = std::thread::Builder::new()
                .name("sift-reveal-failsafe".into())
                .spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if let Some(win) = reveal.get_webview_window("main") {
                        if matches!(win.is_visible(), Ok(true)) {
                            crate::profile_log::milestone(
                                "boot.reveal_failsafe_skip",
                                "already visible",
                            );
                        } else {
                            crate::profile_log::milestone(
                                "boot.reveal_failsafe",
                                "show after 5s",
                            );
                            let _ = win.show();
                        }
                    }
                });
            crate::profile_log::event("boot.setup", setup_start.elapsed(), "");
            crate::profile_log::milestone("boot.setup_done", "");
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if webview.label() != "main" {
                return;
            }
            match payload.event() {
                PageLoadEvent::Started => {
                    crate::profile_log::milestone("boot.page_load_started", payload.url().as_str());
                }
                PageLoadEvent::Finished => {
                    crate::profile_log::milestone("boot.page_load_finished", payload.url().as_str());
                }
            }
        })
        .on_window_event(|_window, event| {
            if let WindowEvent::Focused(focused) = event {
                crate::analyze::set_analyze_workers_for_focus(*focused);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_setting,
            commands::db_stats,
            commands::list_roots,
            commands::add_root,
            commands::remove_root,
            commands::folder_tree,
            commands::set_folder_favorite,
            commands::reindex_root,
            commands::reindex_all,
            commands::list_samples,
            commands::get_samples,
            commands::refresh_sample_availability,
            commands::set_sample_favorite,
            commands::set_sample_bpm,
            commands::set_sample_key,
            commands::set_sample_type,
            commands::reanalyze_samples,
            commands::purge_missing,
            commands::remove_sample,
            commands::respond_ask_index,
            commands::undo_meta,
            commands::redo_meta,
            commands::get_peaks,
            commands::play_sample,
            commands::prefetch_decode,
            commands::set_play_region,
            commands::stop_playback,
            commands::pause_playback,
            commands::resume_playback,
            commands::playback_state,
            commands::list_output_devices,
            commands::set_output_device,
            commands::set_preview_gain,
            commands::set_loop_preview,
            commands::render_jit_clip,
            commands::snap_zero_crossings,
            commands::clear_jit_cache,
            commands::set_clips_dir,
            commands::start_drag_files,
            commands::list_tags,
            commands::create_tag,
            commands::rename_tag,
            commands::move_tag,
            commands::set_tag_color,
            commands::delete_tag,
            commands::set_sample_tags,
            commands::add_sample_tag,
            commands::remove_sample_tag,
            commands::analyze_samples,
            commands::splice_catalog_status,
            commands::refresh_metadata,
            commands::reanalyze_entire_library,
            commands::profile_enabled,
            commands::profile_mark,
            commands::profile_mark_batch,
            commands::profile_log_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
