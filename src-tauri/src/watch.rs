//! Recursive filesystem watch per library root (notify + debouncer).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{EventKind, RecursiveMode};
use notify::event::{ModifyKind, RenameMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::db::settings;
use crate::db::Db;
use crate::error::AppResult;
use crate::indexer::{self, is_audio_file};
use crate::samples;

const DEBOUNCE_MS: u64 = 400;

#[derive(Debug, Clone, Serialize)]
pub struct AskIndexPayload {
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibraryChangedPayload {
    pub reason: String,
}

/// Keeps the debouncer alive. Dropping stops watches.
pub struct WatchGuard {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

pub struct WatchShared {
    pub db: Arc<Db>,
    pub skip_paths: Mutex<HashSet<String>>,
}

impl WatchShared {
    pub fn new(db: Arc<Db>) -> Self {
        Self {
            db,
            skip_paths: Mutex::new(HashSet::new()),
        }
    }
}

pub fn start(
    app: AppHandle,
    shared: Arc<WatchShared>,
    roots: Vec<PathBuf>,
) -> AppResult<WatchGuard> {
    let app_cb = app.clone();
    let shared_cb = Arc::clone(&shared);

    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: DebounceEventResult| {
            match result {
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
            }
        },
    )
    .map_err(|e| crate::error::AppError::msg(e.to_string()))?;

    for root in &roots {
        if root.is_dir() {
            if let Err(e) = debouncer.watch(root.as_path(), RecursiveMode::Recursive) {
                eprintln!("failed to watch {}: {e}", root.display());
            }
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
    let mut changed = false;

    for ev in events {
        match ev.kind {
            EventKind::Create(_) => {
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
                if ev.paths.len() >= 2 {
                    let from = ev.paths[0].clone();
                    let to = ev.paths[1].clone();
                    if looks_like_audio_path(&from) || looks_like_audio_path(&to) {
                        renames.push((from, to));
                    }
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                for p in &ev.paths {
                    if looks_like_audio_path(p) {
                        removed.push(p.clone());
                    }
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                for p in &ev.paths {
                    if p.is_file() && is_audio_file(p) {
                        created.push(p.clone());
                    }
                }
            }
            EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Metadata(_))
            | EventKind::Modify(ModifyKind::Any) => {
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
            changed = true;
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
            changed = true;
        }
    }

    for path in &modified {
        let path_s = path.to_string_lossy().to_string();
        if shared
            .db
            .with_conn(|conn| samples::refresh_technical(conn, &path_s))?
        {
            changed = true;
        }
        // Don't also treat as create
        created.retain(|p| p != path);
    }

    let new_files: Vec<PathBuf> = {
        let skip = shared.skip_paths.lock().expect("skip lock");
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

    if !new_files.is_empty() {
        let mode = shared
            .db
            .with_conn(|conn| {
                Ok(settings::get(conn, "new_file_mode")?
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
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
            let indexed = shared
                .db
                .with_conn(|conn| indexer::index_paths(conn, &new_files))?;
            if indexed > 0 {
                changed = true;
                crate::analyze::enqueue_unanalyzed(
                    app.clone(),
                    shared.db.clone(),
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
                    let _ = app.emit(
                        "auto-indexed",
                        AskIndexPayload { paths },
                    );
                }
            }
        }
    }

    if changed {
        let _ = app.emit(
            "library-changed",
            LibraryChangedPayload {
                reason: "watch".into(),
            },
        );
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
            use diesel::prelude::*;
            use crate::db::schema::roots::dsl as roots_dsl;
            let paths: Vec<String> = roots_dsl::roots.select(roots_dsl::path).load(conn)?;
            Ok(paths.into_iter().map(PathBuf::from).collect::<Vec<_>>())
        })
        .unwrap_or_default();

    let mut slot = guard_slot.lock().expect("watch guard lock");
    // Drop old first
    *slot = None;
    match start(app.clone(), Arc::clone(shared), roots) {
        Ok(guard) => *slot = Some(guard),
        Err(e) => eprintln!("failed to start watches: {e}"),
    }
}
