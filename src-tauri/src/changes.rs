//! Coalesced `library-changed` events.
//!
//! The watcher, the availability backfill and analyze workers all report
//! library changes. Emitting one event per change made the UI refetch the
//! folder tree and the full sample list about once a second during analyze.
//! This merges changes and emits at most one event per [`WINDOW`], saying
//! whether the change was structural (tree and list must refetch) or which
//! rows changed (the UI patches those rows in place).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// How long changes are collected before one event goes out.
const WINDOW: Duration = Duration::from_millis(1500);

/// Above this many changed rows, tell the UI to refetch instead of patching.
const MAX_PATCH_IDS: usize = 2_000;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct LibraryChangedPayload {
    pub reason: String,
    /// Samples added, removed, renamed, or a root changed: refetch tree and list.
    pub structural: bool,
    /// Rows whose fields changed (availability, technical, analysis results).
    pub sample_ids: Vec<i64>,
}

/// Merges change notices and emits at most one `library-changed` per window.
#[derive(Default)]
pub struct ChangeCoalescer {
    pending: Mutex<Option<LibraryChangedPayload>>,
    scheduled: AtomicBool,
}

impl ChangeCoalescer {
    pub fn push(self: &Arc<Self>, app: &AppHandle, reason: &str, structural: bool, ids: &[i64]) {
        merge(
            self.pending
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get_or_insert_with(LibraryChangedPayload::default),
            reason,
            structural,
            ids,
        );
        if self.scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let me = Arc::clone(self);
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("sift-library-changed".into())
            .spawn(move || {
                std::thread::sleep(WINDOW);
                me.scheduled.store(false, Ordering::Release);
                let payload = me
                    .pending
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .take();
                if let Some(payload) = payload.map(finish) {
                    crate::profile_log::count_emit("library-changed");
                    let _ = app.emit("library-changed", payload);
                }
            });
        if spawned.is_err() {
            self.scheduled.store(false, Ordering::Release);
        }
    }
}

/// Fold one change notice into the pending payload.
fn merge(cur: &mut LibraryChangedPayload, reason: &str, structural: bool, ids: &[i64]) {
    cur.structural |= structural;
    cur.sample_ids.extend_from_slice(ids);
    if cur.reason.is_empty() {
        reason.clone_into(&mut cur.reason);
    } else if !cur.reason.split(',').any(|r| r == reason) {
        cur.reason.push(',');
        cur.reason.push_str(reason);
    }
}

/// Dedup ids; switch to a structural refresh when too many rows changed.
fn finish(mut payload: LibraryChangedPayload) -> LibraryChangedPayload {
    payload.sample_ids.sort_unstable();
    payload.sample_ids.dedup();
    if payload.structural || payload.sample_ids.len() > MAX_PATCH_IDS {
        payload.structural = true;
        payload.sample_ids.clear();
    }
    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_combines_flags_ids_and_reasons() {
        let mut p = LibraryChangedPayload::default();
        merge(&mut p, "watch", false, &[3, 1]);
        merge(&mut p, "analyze", false, &[1, 2]);
        merge(&mut p, "watch", false, &[]);
        let p = finish(p);
        assert!(!p.structural);
        assert_eq!(p.sample_ids, vec![1, 2, 3]);
        assert_eq!(p.reason, "watch,analyze");
    }

    #[test]
    fn structural_wins_and_drops_ids() {
        let mut p = LibraryChangedPayload::default();
        merge(&mut p, "analyze", false, &[1]);
        merge(&mut p, "watch", true, &[]);
        let p = finish(p);
        assert!(p.structural);
        assert_eq!(p.sample_ids, Vec::<i64>::new());
    }

    #[test]
    fn too_many_ids_becomes_structural() {
        let ids: Vec<i64> = (0..3_000).collect();
        let mut p = LibraryChangedPayload::default();
        merge(&mut p, "availability", false, &ids);
        let p = finish(p);
        assert!(p.structural);
        assert_eq!(p.sample_ids, Vec::<i64>::new());
    }
}
