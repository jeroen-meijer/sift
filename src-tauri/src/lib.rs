mod audio;
mod commands;
mod db;
mod error;
mod indexer;
mod library;
mod paths;
mod samples;
mod state;
mod tags;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::init().expect("failed to initialize Sift app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .manage(app_state)
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
