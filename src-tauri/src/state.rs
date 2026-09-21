use std::sync::{Arc, Mutex};

use crate::audio::PlayerEngine;
use crate::db::Db;
use crate::error::AppResult;
use crate::paths::AppPaths;
use crate::undo::UndoStack;
use crate::watch::{WatchGuard, WatchShared};

pub struct AppState {
    pub paths: AppPaths,
    pub db: Arc<Db>,
    pub player: Mutex<PlayerEngine>,
    pub undo: Mutex<UndoStack>,
    pub watch_shared: Arc<WatchShared>,
    pub watch_guard: Mutex<Option<WatchGuard>>,
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        let paths = AppPaths::resolve()?;
        let db = Arc::new(Db::open(&paths)?);
        let watch_shared = Arc::new(WatchShared::new(Arc::clone(&db)));

        let mut player = PlayerEngine::new();
        // Seed player prefs from settings when present.
        let _ = db.with_conn(|conn| {
            use crate::db::settings;
            if let Some(v) = settings::get(conn, "preview_gain_db")? {
                if let Some(db_val) = v.as_f64() {
                    player.set_gain_db(db_val as f32);
                }
            }
            if let Some(v) = settings::get(conn, "loop_preview")? {
                if let Some(on) = v.as_bool() {
                    player.set_loop_preview(on);
                }
            }
            if let Some(v) = settings::get(conn, "output_device")? {
                if let Some(id) = v.as_str() {
                    let _ = player.set_device(id);
                }
            }
            Ok(())
        });

        Ok(Self {
            paths,
            db,
            player: Mutex::new(player),
            undo: Mutex::new(UndoStack::default()),
            watch_shared,
            watch_guard: Mutex::new(None),
        })
    }
}
