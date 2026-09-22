use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde_json::{Value, json};

use crate::db::models::Setting;
use crate::db::schema::settings::dsl as settings_dsl;
use crate::error::{AppError, AppResult};
use crate::paths::AppPaths;

pub const DEFAULT_IGNORE: &[&str] = &[
    "**/.git/**",
    "**/node_modules/**",
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/__MACOSX/**",
    "**/Bounces/**",
    "**/*.asd",
];

pub fn ensure_defaults(conn: &mut SqliteConnection, paths: &AppPaths) -> AppResult<()> {
    let defaults = json!({
        "play_on_select": true,
        "loop_preview": true,
        "row_waveforms": true,
        "snap": "1/4",
        "waveform_view": "stereo",
        "output_device": "default",
        "preview_gain_db": -6.0,
        "bpm_range_min": 70,
        "bpm_range_max": 180,
        "new_file_mode": "auto",
        "notify_auto_index": false,
        "ignore_list": DEFAULT_IGNORE,
        "sort_column": "name",
        "sort_direction": "asc",
        "half_double_bpm": false,
        "relative_key": false,
        "hold_hover_hotkey": null,
        "clips_dir": paths.clips_dir.to_string_lossy(),
        "theme": "dark-default",
        "locale": "en"
    });

    if let Value::Object(map) = defaults {
        for (key, value) in map {
            let exists = settings_dsl::settings
                .find(&key)
                .select(settings_dsl::key)
                .first::<String>(conn)
                .optional()
                .map_err(AppError::from)?;
            if exists.is_none() {
                diesel::insert_into(settings_dsl::settings)
                    .values(Setting {
                        key: key.clone(),
                        value: value.to_string(),
                    })
                    .execute(conn)
                    .map_err(AppError::from)?;
            }
        }
    }
    Ok(())
}

pub fn get_all(conn: &mut SqliteConnection) -> AppResult<Value> {
    let rows: Vec<(String, String)> = settings_dsl::settings
        .select((settings_dsl::key, settings_dsl::value))
        .load(conn)
        .map_err(AppError::from)?;

    let mut map = serde_json::Map::new();
    for (key, value) in rows {
        let parsed: Value = serde_json::from_str(&value).unwrap_or(Value::String(value));
        map.insert(key, parsed);
    }
    Ok(Value::Object(map))
}

pub fn get(conn: &mut SqliteConnection, key: &str) -> AppResult<Option<Value>> {
    let value = settings_dsl::settings
        .find(key)
        .select(settings_dsl::value)
        .first::<String>(conn)
        .optional()
        .map_err(AppError::from)?;
    Ok(value.map(|v| serde_json::from_str(&v).unwrap_or(Value::String(v))))
}

pub fn set(conn: &mut SqliteConnection, key: &str, value: &Value) -> AppResult<()> {
    diesel::insert_into(settings_dsl::settings)
        .values(Setting {
            key: key.to_string(),
            value: value.to_string(),
        })
        .on_conflict(settings_dsl::key)
        .do_update()
        .set(settings_dsl::value.eq(value.to_string()))
        .execute(conn)
        .map_err(AppError::from)?;
    Ok(())
}
