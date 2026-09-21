mod commands;
mod db;
mod error;
mod paths;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::init().expect("failed to initialize Sift app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_setting,
            commands::db_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
