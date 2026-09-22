mod analyze;
mod audio;
mod commands;
mod db;
mod error;
mod ids;
mod indexer;
mod library;
mod paths;
mod perf_budgets;
mod samples;
mod state;
mod tags;
mod undo;
mod watch;

/// Hot-path surface for Criterion benches and perf budget tests.
/// Not part of the Tauri IPC contract.
pub mod perf {
    pub use crate::analyze::{Analyzer, HeuristicAnalyzer, PathTokenAnalyzer};
    pub use crate::audio::decode::{DecodedAudio, decode_file};
    pub use crate::audio::jit::render_clip;
    pub use crate::audio::peaks::{DEFAULT_BUCKETS, generate_peaks};
}

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::expect_used, clippy::panic)] // Tauri entry: fail-fast on unrecoverable init
pub fn run() {
    let app_state = AppState::init().expect("failed to initialize Sift app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .manage(app_state)
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            watch::restart(&handle, &state.watch_shared, &state.watch_guard);
            Ok(())
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
            commands::stop_playback,
            commands::pause_playback,
            commands::resume_playback,
            commands::list_output_devices,
            commands::set_output_device,
            commands::set_preview_gain,
            commands::set_loop_preview,
            commands::render_jit_clip,
            commands::clear_jit_cache,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
