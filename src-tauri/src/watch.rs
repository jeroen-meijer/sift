//! Recursive filesystem watch per library root (notify + debouncer).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::changes::ChangeCoalescer;
use crate::db::Db;
use crate::db::settings;
use crate::error::AppResult;
use crate::indexer::{self, is_audio_file};
use crate::samples;

const DEBOUNCE_MS: u64 = 400;

#[derive(Debug, Clone, Serialize)]
pub struct AskIndexPayload {
    pub paths: Vec<String>,
}

/// Keeps the debouncer alive. Dropping stops watches.
pub struct WatchGuard {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

pub struct WatchShared {
    pub db: Arc<Db>,
    pub peaks_dir: PathBuf,
    pub changes: Arc<ChangeCoalescer>,
    pub skip_paths: Mutex<HashSet<String>>,
}

impl WatchShared {
    pub fn new(db: Arc<Db>, peaks_dir: PathBuf, changes: Arc<ChangeCoalescer>) -> Self {
        Self {
            db,
            peaks_dir,
            changes,
            skip_paths: Mutex::new(HashSet::new()),
        }
    }
}

pub fn start(
    app: AppHandle,
    shared: Arc<WatchShared>,
    roots: Vec<PathBuf>,
) -> AppResult<WatchGuard> {
    let app_cb = app;
    let shared_cb = Arc::clone(&shared);

    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                if let Err(e) = handle_events(&app_cb, &shared_cb, &events) {
                    eprintln!("watch handler error: {e}");
                }
            }
            Err(errors) => {
                for err in errors {
                    eprintln!("watch error: {err}");
                }
            }
        },
    )
    .map_err(|e| crate::error::AppError::msg(e.to_string()))?;

    for root in &roots {
        if root.is_dir()
            && let Err(e) = debouncer.watch(root.as_path(), RecursiveMode::Recursive)
        {
            eprintln!("failed to watch {}: {e}", root.display());
        }
    }

    Ok(WatchGuard {
        _debouncer: debouncer,
    })
}

fn handle_events(
    app: &AppHandle,
    shared: &WatchShared,
    events: &[notify_debouncer_full::DebouncedEvent],
) -> AppResult<()> {
    let mut created: Vec<PathBuf> = Vec::new();
    let mut removed: Vec<PathBuf> = Vec::new();
    let mut modified: Vec<PathBuf> = Vec::new();
    let mut renames: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut structural = false;
    let mut changed_ids: Vec<i64> = Vec::new();
    let mut became_local: Vec<i64> = Vec::new();

    for ev in events {
        match ev.kind {
            EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                for p in &ev.paths {
                    if p.is_file() && is_audio_file(p) {
                        created.push(p.clone());
                    }
                }
            }
            EventKind::Remove(_) => {
                for p in &ev.paths {
                    if is_audio_file(p) || looks_like_audio_path(p) {
                        removed.push(p.clone());
                    }
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                if let [from, to, ..] = ev.paths.as_slice()
                    && (looks_like_audio_path(from) || looks_like_audio_path(to))
                {
                    renames.push((from.clone(), to.clone()));
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                for p in &ev.paths {
                    if looks_like_audio_path(p) {
                        removed.push(p.clone());
                    }
                }
            }
            EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_) | ModifyKind::Any) => {
                for p in &ev.paths {
                    if p.is_file() && is_audio_file(p) {
                        modified.push(p.clone());
                    }
                }
            }
            _ => {}
        }
    }

    // Dedupe
    created.sort();
    created.dedup();
    removed.sort();
    removed.dedup();
    modified.sort();
    modified.dedup();

    for (from, to) in &renames {
        let from_s = from.to_string_lossy().to_string();
        let to_s = to.to_string_lossy().to_string();
        let updated = shared
            .db
            .with_conn(|conn| samples::update_path(conn, &from_s, &to_s))?;
        if updated {
            structural = true;
            // Drop create/remove for these paths if present
            created.retain(|p| p != to);
            removed.retain(|p| p != from);
        } else if to.is_file() && is_audio_file(to) {
            created.push(to.clone());
            removed.push(from.clone());
        }
    }

    for path in &removed {
        let path_s = path.to_string_lossy().to_string();
        if shared
            .db
            .with_conn(|conn| samples::mark_missing(conn, &path_s))?
        {
            structural = true;
        }
    }

    for path in &modified {
        let path_s = path.to_string_lossy().to_string();
        if let Some(refresh) = samples::refresh_technical(&shared.db, &path_s)? {
            if refresh.changed {
                changed_ids.push(refresh.sample_id);
            }
            if refresh.became_local {
                became_local.push(refresh.sample_id);
            } else if refresh.content_changed {
                // Stale waveform and technical fields: drop the peakfile so
                // the analyze queue rebuilds it (and the status bar shows it).
                let _ = std::fs::remove_file(
                    shared
                        .peaks_dir
                        .join(format!("{}.peaks", refresh.sample_id)),
                );
                became_local.push(refresh.sample_id);
            }
        }
        // Don't also treat as create
        created.retain(|p| p != path);
    }

    let new_files: Vec<PathBuf> = {
        let skip = shared
            .skip_paths
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        created
            .into_iter()
            .filter(|p| {
                let s = p.to_string_lossy().to_string();
                !skip.contains(&s)
            })
            .filter(|p| {
                shared
                    .db
                    .with_conn(|conn| samples::get_sample_by_path(conn, &p.to_string_lossy()))
                    .ok()
                    .flatten()
                    .is_none()
            })
            .collect()
    };

    if !became_local.is_empty() {
        became_local.sort_unstable();
        became_local.dedup();
        changed_ids.extend_from_slice(&became_local);
        crate::analyze::enqueue_ids(
            app.clone(),
            shared.db.clone(),
            shared.peaks_dir.clone(),
            became_local,
        );
    }

    if !new_files.is_empty() {
        let mode = shared
            .db
            .with_conn(|conn| {
                Ok(settings::get(conn, "new_file_mode")?
                    .and_then(|v| v.as_str().map(ToString::to_string))
                    .unwrap_or_else(|| "auto".into()))
            })
            .unwrap_or_else(|_| "auto".into());

        if mode == "ask" {
            let paths: Vec<String> = new_files
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let _ = app.emit("ask-index", AskIndexPayload { paths });
        } else {
            let total = u64::try_from(new_files.len()).unwrap_or(u64::MAX);
            crate::analyze::work::start(app, total);
            let indexed = shared
                .db
                .with_conn(|conn| indexer::index_paths(conn, &new_files))?;
            crate::analyze::work::finish(app, indexed);
            if indexed > 0 {
                structural = true;
                crate::analyze::enqueue_unanalyzed(
                    app.clone(),
                    shared.db.clone(),
                    shared.peaks_dir.clone(),
                );
                let notify = shared
                    .db
                    .with_conn(|conn| {
                        Ok(settings::get(conn, "notify_auto_index")?
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false))
                    })
                    .unwrap_or(false);
                if notify {
                    let paths: Vec<String> = new_files
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
                    let _ = app.emit("auto-indexed", AskIndexPayload { paths });
                }
            }
        }
    }

    if structural || !changed_ids.is_empty() {
        shared.changes.push(app, "watch", structural, &changed_ids);
    }
    Ok(())
}

fn looks_like_audio_path(path: &Path) -> bool {
    is_audio_file(path)
}

/// Restart watches for all current roots. Replaces any previous guard.
pub fn restart(app: &AppHandle, shared: &Arc<WatchShared>, guard_slot: &Mutex<Option<WatchGuard>>) {
    let roots: Vec<PathBuf> = shared
        .db
        .with_conn(|conn| {
            use crate::db::schema::roots::dsl as roots_dsl;
            use diesel::prelude::*;
            let paths: Vec<String> = roots_dsl::roots.select(roots_dsl::path).load(conn)?;
            Ok(paths.into_iter().map(PathBuf::from).collect::<Vec<_>>())
        })
        .unwrap_or_default();

    let n_roots = roots.len();
    let reg_start = Instant::now();
    let mut slot = guard_slot
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // Drop old first
    *slot = None;
    match start(app.clone(), Arc::clone(shared), roots) {
        Ok(guard) => *slot = Some(guard),
        Err(e) => eprintln!("failed to start watches: {e}"),
    }
    drop(slot);
    crate::profile_log::event(
        "watch.register",
        reg_start.elapsed(),
        &format!("roots={n_roots}"),
    );
}

/// Run [`restart`] on a background thread. Recursive watches can take seconds
/// on large roots, so this must not run on the IPC or setup path. Shared by
/// boot, `add_root`, and `remove_root`.
pub fn restart_in_background(
    app: AppHandle,
    shared: Arc<WatchShared>,
    guard_slot: Arc<Mutex<Option<WatchGuard>>>,
) {
    let _ = std::thread::Builder::new()
        .name("sift-watch-restart".into())
        .spawn(move || {
            restart(&app, &shared, &guard_slot);
        });
}
