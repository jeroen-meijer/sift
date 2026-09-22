//! In-memory undo/redo for sample metadata edits (session-scoped, bounded).

use std::collections::VecDeque;

use diesel::sqlite::SqliteConnection;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::samples;
use crate::tags;

const MAX_STACK: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UndoAction {
    Favorite {
        id: i64,
        before: bool,
        after: bool,
    },
    TagAdd {
        sample_id: i64,
        tag_id: i64,
    },
    TagRemove {
        sample_id: i64,
        tag_id: i64,
    },
    Bpm {
        id: i64,
        before: Option<f64>,
        after: Option<f64>,
    },
    Key {
        id: i64,
        before: Option<String>,
        after: Option<String>,
    },
    SampleType {
        id: i64,
        before: Option<String>,
        after: Option<String>,
    },
}

#[derive(Default)]
pub struct UndoStack {
    undo: VecDeque<UndoAction>,
    redo: VecDeque<UndoAction>,
}

impl UndoStack {
    pub fn push(&mut self, action: UndoAction) {
        self.undo.push_back(action);
        while self.undo.len() > MAX_STACK {
            self.undo.pop_front();
        }
        self.redo.clear();
    }

    pub fn undo(&mut self, conn: &mut SqliteConnection) -> AppResult<Option<UndoAction>> {
        let Some(action) = self.undo.pop_back() else {
            return Ok(None);
        };
        apply_inverse(conn, &action)?;
        self.redo.push_back(action.clone());
        while self.redo.len() > MAX_STACK {
            self.redo.pop_front();
        }
        Ok(Some(action))
    }

    pub fn redo(&mut self, conn: &mut SqliteConnection) -> AppResult<Option<UndoAction>> {
        let Some(action) = self.redo.pop_back() else {
            return Ok(None);
        };
        apply_forward(conn, &action)?;
        self.undo.push_back(action.clone());
        while self.undo.len() > MAX_STACK {
            self.undo.pop_front();
        }
        Ok(Some(action))
    }

    #[allow(dead_code, reason = "public stack API used by future UI state")]
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    #[allow(dead_code, reason = "public stack API used by future UI state")]
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

fn apply_inverse(conn: &mut SqliteConnection, action: &UndoAction) -> AppResult<()> {
    match action {
        UndoAction::Favorite { id, before, .. } => samples::set_sample_favorite(conn, *id, *before),
        UndoAction::TagAdd { sample_id, tag_id } => {
            tags::remove_sample_tag(conn, *sample_id, *tag_id)
        }
        UndoAction::TagRemove { sample_id, tag_id } => {
            tags::add_sample_tag(conn, *sample_id, *tag_id)
        }
        UndoAction::Bpm { id, before, .. } => samples::set_sample_bpm(conn, *id, *before),
        UndoAction::Key { id, before, .. } => samples::set_sample_key(conn, *id, before.as_deref()),
        UndoAction::SampleType { id, before, .. } => {
            samples::set_sample_type(conn, *id, before.as_deref())
        }
    }
}

fn apply_forward(conn: &mut SqliteConnection, action: &UndoAction) -> AppResult<()> {
    match action {
        UndoAction::Favorite { id, after, .. } => samples::set_sample_favorite(conn, *id, *after),
        UndoAction::TagAdd { sample_id, tag_id } => tags::add_sample_tag(conn, *sample_id, *tag_id),
        UndoAction::TagRemove { sample_id, tag_id } => {
            tags::remove_sample_tag(conn, *sample_id, *tag_id)
        }
        UndoAction::Bpm { id, after, .. } => samples::set_sample_bpm(conn, *id, *after),
        UndoAction::Key { id, after, .. } => samples::set_sample_key(conn, *id, after.as_deref()),
        UndoAction::SampleType { id, after, .. } => {
            samples::set_sample_type(conn, *id, after.as_deref())
        }
    }
}
