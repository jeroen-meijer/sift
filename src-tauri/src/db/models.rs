//! Diesel models for the Sift library database.

use diesel::prelude::*;

use super::schema::{
    favorite_folders, meta, redo_stack, roots, sample_tags, samples, settings, tag_rejects, tags,
    undo_stack,
};

#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = roots)]
pub struct Root {
    pub id: i32,
    pub path: String,
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = roots)]
pub struct NewRoot<'a> {
    pub path: &'a str,
    pub label: Option<&'a str>,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, AsChangeset)]
#[diesel(table_name = samples)]
#[allow(
    clippy::struct_field_names,
    reason = "field names mirror the `samples` table columns"
)]
pub struct Sample {
    pub id: i32,
    pub root_id: i32,
    pub path: String,
    pub filename: String,
    pub parent_path: String,
    pub extension: String,
    pub size_bytes: Option<i64>,
    pub mtime_ms: Option<i64>,
    pub inode: Option<i64>,
    pub missing: i32,
    pub sample_rate: Option<i32>,
    pub bit_depth: Option<i32>,
    pub channels: Option<i32>,
    pub duration_ms: Option<f64>,
    pub format: Option<String>,
    pub bpm: Option<f64>,
    pub bpm_confidence: Option<f64>,
    pub key_name: Option<String>,
    pub key_confidence: Option<f64>,
    pub sample_type: Option<String>,
    pub favorite: i32,
    pub analyzed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = samples)]
pub struct NewSample<'a> {
    pub root_id: i32,
    pub path: &'a str,
    pub filename: &'a str,
    pub parent_path: &'a str,
    pub extension: &'a str,
    pub size_bytes: Option<i64>,
    pub mtime_ms: Option<i64>,
    pub inode: Option<i64>,
}

#[derive(Debug, Clone, Queryable, Selectable, Identifiable, AsChangeset)]
#[diesel(table_name = tags)]
pub struct Tag {
    pub id: i32,
    pub path: String,
    pub name: String,
    pub parent_id: Option<i32>,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = tags)]
pub struct NewTag<'a> {
    pub path: &'a str,
    pub name: &'a str,
    pub parent_id: Option<i32>,
    pub color: Option<&'a str>,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = sample_tags)]
pub struct SampleTag {
    pub sample_id: i32,
    pub tag_id: i32,
    pub source: String,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = tag_rejects)]
pub struct TagReject {
    pub sample_id: i32,
    pub tag_id: i32,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = settings)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = meta)]
pub struct Meta {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = favorite_folders)]
pub struct FavoriteFolder {
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = undo_stack)]
pub struct UndoRow {
    pub id: i32,
    pub created_at: String,
    pub action_json: String,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable)]
#[diesel(table_name = redo_stack)]
pub struct RedoRow {
    pub id: i32,
    pub created_at: String,
    pub action_json: String,
}
