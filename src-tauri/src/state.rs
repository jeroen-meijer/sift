use std::path::PathBuf;
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
    /// Where JIT clips are written. Settings can move it, so it is not in `paths`.
    clips_dir: Mutex<PathBuf>,
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        let paths = AppPaths::resolve()?;
        let db = Arc::new(Db::open(&paths)?);
        let watch_shared = Arc::new(WatchShared::new(Arc::clone(&db)));

        let mut clips_dir = paths.clips_dir.clone();
        let mut player = PlayerEngine::new();
        // Seed player prefs from settings when present.
        let _ = db.with_conn(|conn| {
            use crate::db::settings;
            if let Some(v) = settings::get(conn, "preview_gain_db")?
                && let Some(db_val) = v.as_f64()
            {
                player.set_gain_db(crate::ids::f64_to_f32(db_val));
            }
            if let Some(v) = settings::get(conn, "loop_preview")?
                && let Some(on) = v.as_bool()
            {
                player.set_loop_preview(on);
            }
            if let Some(v) = settings::get(conn, "output_device")?
                && let Some(id) = v.as_str()
            {
                let _ = player.set_device(id);
            }
            if let Some(v) = settings::get(conn, "clips_dir")?
                && let Some(dir) = v.as_str()
                && !dir.is_empty()
            {
                clips_dir = PathBuf::from(dir);
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
            clips_dir: Mutex::new(clips_dir),
        })
    }

    pub fn clips_dir(&self) -> PathBuf {
        self.clips_dir
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub fn set_clips_dir(&self, dir: PathBuf) {
        *self
            .clips_dir
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = dir;
    }
}
