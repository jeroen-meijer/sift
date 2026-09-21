use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::error::AppResult;
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

pub fn ensure_defaults(conn: &Connection, paths: &AppPaths) -> AppResult<()> {
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
            let exists: bool = conn.query_row(
                "SELECT 1 FROM settings WHERE key = ?1",
                params![key],
                |_| Ok(true),
            )
            .unwrap_or(false);
            if !exists {
                conn.execute(
                    "INSERT INTO settings(key, value) VALUES (?1, ?2)",
                    params![key, value.to_string()],
                )?;
            }
        }
    }
    Ok(())
}

pub fn get_all(conn: &Connection) -> AppResult<Value> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok((key, value))
    })?;

    let mut map = serde_json::Map::new();
    for row in rows {
        let (key, value) = row?;
        let parsed: Value = serde_json::from_str(&value).unwrap_or(Value::String(value));
        map.insert(key, parsed);
    }
    Ok(Value::Object(map))
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<Value>> {
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(value) => {
            let parsed: Value = serde_json::from_str(&value).unwrap_or(Value::String(value));
            Ok(Some(parsed))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn set(conn: &Connection, key: &str, value: &Value) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}
