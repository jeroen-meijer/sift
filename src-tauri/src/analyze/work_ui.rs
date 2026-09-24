//! Bottom-right status bar for any file-processing job.
//!
//! Indexing, availability checks, catalog refresh, and the analyze queue all
//! report through this module. The UI listens to `analysis-queue` and
//! `analysis-progress` only.

use tauri::{AppHandle, Emitter};

use super::{AnalysisProgress, AnalysisQueuePayload};

/// Open the bar for `total` units of work.
///
/// Pass `total = 0` when the size is unknown (walking a folder tree). The UI
/// shows a spinner and a running count until [`finish`] or a later job with a
/// known total takes over.
pub fn start(app: &AppHandle, total: u64) {
    crate::profile_log::count_emit("analysis-queue");
    let _ = app.emit("analysis-queue", &AnalysisQueuePayload { total });
}

/// Full progress update (analyze queue: multiple `active_ids`).
pub fn update(app: &AppHandle, progress: &AnalysisProgress) {
    crate::profile_log::count_emit("analysis-progress");
    let _ = app.emit("analysis-progress", progress);
}

/// Progress for a single-threaded job (`done` toward `total`, or rising while
/// `total` is 0).
pub fn tick(app: &AppHandle, done: u64, total: u64, sample_id: i64) {
    let remaining = if total == 0 {
        // Keep the bar open until [`finish`].
        1
    } else {
        total.saturating_sub(done)
    };
    update(
        app,
        &AnalysisProgress {
            sample_id,
            done,
            remaining,
            total,
            active_ids: if sample_id == 0 {
                Vec::new()
            } else {
                vec![sample_id]
            },
        },
    );
}

/// Clear the bar (or hand off to the next job that calls [`start`]).
pub fn finish(app: &AppHandle, done: u64) {
    update(
        app,
        &AnalysisProgress {
            sample_id: 0,
            done,
            remaining: 0,
            total: done.max(1),
            active_ids: Vec::new(),
        },
    );
}
