use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use crate::audio::{DecodeCache, PlayerEngine};
use crate::changes::ChangeCoalescer;
use crate::db::Db;
use crate::error::AppResult;
use crate::paths::AppPaths;
use crate::undo::UndoStack;
use crate::watch::{WatchGuard, WatchShared};

pub struct AppState {
    pub paths: AppPaths,
    pub db: Arc<Db>,
    pub player: Mutex<PlayerEngine>,
    /// Decoded PCM LRU for select→play / prefetch (see SPEC audition latency).
    pub decode_cache: Mutex<DecodeCache>,
    pub undo: Mutex<UndoStack>,
    /// Highest play/stop/pause request number seen from the UI. A play whose
    /// decode finishes after a newer request is dropped instead of started.
    pub play_seq: AtomicU64,
    pub watch_shared: Arc<WatchShared>,
    /// Merges library changes into at most one `library-changed` per window.
    pub changes: Arc<ChangeCoalescer>,
    pub watch_guard: Arc<Mutex<Option<WatchGuard>>>,
    /// Where JIT clips are written. Settings can move it, so it is not in `paths`.
    clips_dir: Mutex<PathBuf>,
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        let paths = crate::profile_log::time("boot.paths_resolve", "", AppPaths::resolve)?;
        let db = crate::profile_log::time("boot.db_open", "", || Db::open(&paths).map(Arc::new))?;
        let changes = Arc::new(ChangeCoalescer::default());
        let watch_shared = Arc::new(WatchShared::new(
            Arc::clone(&db),
            paths.peaks_dir.clone(),
            Arc::clone(&changes),
        ));

        let mut clips_dir = paths.clips_dir.clone();
        let mut player = PlayerEngine::new();
        // Seed player prefs from settings when present.
        crate::profile_log::time("boot.player_seed", "", || {
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
        });

        Ok(Self {
            paths,
            db,
            player: Mutex::new(player),
            decode_cache: Mutex::new(DecodeCache::default()),
            undo: Mutex::new(UndoStack::default()),
            play_seq: AtomicU64::new(0),
            watch_shared,
            changes,
            watch_guard: Arc::new(Mutex::new(None)),
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
