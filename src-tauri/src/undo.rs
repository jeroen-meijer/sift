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
        before_source: Option<String>,
        after: Option<f64>,
        after_source: Option<String>,
    },
    Key {
        id: i64,
        before: Option<String>,
        before_source: Option<String>,
        after: Option<String>,
        after_source: Option<String>,
    },
    SampleType {
        id: i64,
        before: Option<String>,
        before_source: Option<String>,
        after: Option<String>,
        after_source: Option<String>,
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
        match apply_inverse(conn, &action) {
            Ok(()) => {
                self.redo.push_back(action.clone());
                while self.redo.len() > MAX_STACK {
                    self.redo.pop_front();
                }
                Ok(Some(action))
            }
            Err(e) => {
                self.undo.push_back(action);
                Err(e)
            }
        }
    }

    pub fn redo(&mut self, conn: &mut SqliteConnection) -> AppResult<Option<UndoAction>> {
        let Some(action) = self.redo.pop_back() else {
            return Ok(None);
        };
        match apply_forward(conn, &action) {
            Ok(()) => {
                self.undo.push_back(action.clone());
                while self.undo.len() > MAX_STACK {
                    self.undo.pop_front();
                }
                Ok(Some(action))
            }
            Err(e) => {
                self.redo.push_back(action);
                Err(e)
            }
        }
    }

    #[allow(dead_code, reason = "public stack API used by future UI state")]
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    #[allow(dead_code, reason = "public stack API used by future UI state")]
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    #[cfg(test)]
    pub fn undo_len(&self) -> usize {
        self.undo.len()
    }
}

fn apply_inverse(conn: &mut SqliteConnection, action: &UndoAction) -> AppResult<()> {
    match action {
        UndoAction::Favorite { id, before, .. } => samples::set_sample_favorite(conn, *id, *before),
        UndoAction::TagAdd { sample_id, tag_id } => {
            tags::remove_sample_tag(conn, *sample_id, *tag_id)
        }
        UndoAction::TagRemove { sample_id, tag_id } => {
            let _ = tags::add_sample_tag(conn, *sample_id, *tag_id)?;
            Ok(())
        }
        UndoAction::Bpm {
            id,
            before,
            before_source,
            ..
        } => samples::restore_sample_bpm(conn, *id, *before, before_source.as_deref()),
        UndoAction::Key {
            id,
            before,
            before_source,
            ..
        } => samples::restore_sample_key(conn, *id, before.as_deref(), before_source.as_deref()),
        UndoAction::SampleType {
            id,
            before,
            before_source,
            ..
        } => samples::restore_sample_type(conn, *id, before.as_deref(), before_source.as_deref()),
    }
}

fn apply_forward(conn: &mut SqliteConnection, action: &UndoAction) -> AppResult<()> {
    match action {
        UndoAction::Favorite { id, after, .. } => samples::set_sample_favorite(conn, *id, *after),
        UndoAction::TagAdd { sample_id, tag_id } => {
            let _ = tags::add_sample_tag(conn, *sample_id, *tag_id)?;
            Ok(())
        }
        UndoAction::TagRemove { sample_id, tag_id } => {
            tags::remove_sample_tag(conn, *sample_id, *tag_id)
        }
        UndoAction::Bpm {
            id,
            after,
            after_source,
            ..
        } => samples::restore_sample_bpm(conn, *id, *after, after_source.as_deref()),
        UndoAction::Key {
            id,
            after,
            after_source,
            ..
        } => samples::restore_sample_key(conn, *id, after.as_deref(), after_source.as_deref()),
        UndoAction::SampleType {
            id,
            after,
            after_source,
            ..
        } => samples::restore_sample_type(conn, *id, after.as_deref(), after_source.as_deref()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::roots::dsl as roots_dsl;
    use crate::db::schema::samples::dsl as samples_dsl;
    use crate::db::schema::tags::dsl as tags_dsl;
    use crate::ids::id_to_i64;
    use diesel::prelude::*;

    fn seed_sample(conn: &mut SqliteConnection) -> i64 {
        diesel::insert_into(roots_dsl::roots)
            .values((roots_dsl::path.eq("/lib"), roots_dsl::label.eq("lib")))
            .execute(conn)
            .unwrap();
        let root_id: i32 = roots_dsl::roots.select(roots_dsl::id).first(conn).unwrap();
        diesel::insert_into(samples_dsl::samples)
            .values((
                samples_dsl::root_id.eq(root_id),
                samples_dsl::path.eq("/lib/a.wav"),
                samples_dsl::filename.eq("a.wav"),
                samples_dsl::parent_path.eq("/lib"),
                samples_dsl::extension.eq("wav"),
                samples_dsl::bpm.eq(Some(120.0)),
                samples_dsl::bpm_source.eq(Some("analysis")),
            ))
            .execute(conn)
            .unwrap();
        let id: i32 = samples_dsl::samples
            .select(samples_dsl::id)
            .first(conn)
            .unwrap();
        id_to_i64(id)
    }

    #[test]
    fn undo_bpm_restores_analysis_source() {
        let mut conn = crate::db::test_conn();
        let id = seed_sample(&mut conn);
        let mut stack = UndoStack::default();
        stack.push(UndoAction::Bpm {
            id,
            before: Some(120.0),
            before_source: Some("analysis".into()),
            after: Some(128.0),
            after_source: Some("user".into()),
        });
        samples::set_sample_bpm(&mut conn, id, Some(128.0)).unwrap();
        stack.undo(&mut conn).unwrap();
        let (bpm, source): (Option<f64>, Option<String>) = samples_dsl::samples
            .find(crate::ids::id_from_i64(id).unwrap())
            .select((samples_dsl::bpm, samples_dsl::bpm_source))
            .first(&mut conn)
            .unwrap();
        assert_eq!(bpm, Some(120.0));
        assert_eq!(source.as_deref(), Some("analysis"));
    }

    #[test]
    fn failed_undo_keeps_action_on_stack() {
        let mut conn = crate::db::test_conn();
        let mut stack = UndoStack::default();
        stack.push(UndoAction::Bpm {
            id: 9_999_999,
            before: Some(1.0),
            before_source: Some("analysis".into()),
            after: Some(2.0),
            after_source: Some("user".into()),
        });
        assert!(stack.undo(&mut conn).is_err());
        assert_eq!(stack.undo_len(), 1);
    }

    #[test]
    fn add_existing_tag_returns_false() {
        let mut conn = crate::db::test_conn();
        let sample_id = seed_sample(&mut conn);
        diesel::insert_into(tags_dsl::tags)
            .values((
                tags_dsl::path.eq("Kick"),
                tags_dsl::name.eq("Kick"),
                tags_dsl::parent_id.eq(Option::<i32>::None),
            ))
            .execute(&mut conn)
            .unwrap();
        let tag_id: i32 = tags_dsl::tags
            .select(tags_dsl::id)
            .first(&mut conn)
            .unwrap();
        let tag_id = id_to_i64(tag_id);
        assert!(tags::add_sample_tag(&mut conn, sample_id, tag_id).unwrap());
        assert!(!tags::add_sample_tag(&mut conn, sample_id, tag_id).unwrap());
    }
}
