use std::collections::HashMap;

use diesel::dsl::{exists, sql};
use diesel::prelude::*;
use diesel::sql_types::{Bool, Text};
use diesel::sqlite::SqliteConnection;
use serde::{Deserialize, Serialize};

use crate::db::models::Sample;
use crate::db::schema::sample_tags::dsl as sample_tags_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::schema::tags::dsl as tags_dsl;
use crate::db::utc_now;
use crate::error::{AppError, AppResult};
use crate::fs_ready::{self, Availability};
use crate::ids::{id_from_i64, id_to_i64};

#[derive(Debug, Clone, Serialize)]
pub struct TagChip {
    pub id: i64,
    pub path: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SampleDto {
    pub id: i64,
    pub root_id: i64,
    pub path: String,
    pub filename: String,
    pub parent_path: String,
    pub extension: String,
    pub size_bytes: Option<i64>,
    pub missing: bool,
    /// `local` | `cloud` | `missing` | `unknown`
    pub availability: String,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
    pub channels: Option<i64>,
    pub duration_ms: Option<f64>,
    pub format: Option<String>,
    pub bpm: Option<f64>,
    pub key_name: Option<String>,
    pub sample_type: Option<String>,
    pub favorite: bool,
    pub tags: Vec<TagChip>,
    pub catalog_source: Option<String>,
    pub bpm_source: Option<String>,
    pub key_source: Option<String>,
    pub sample_type_source: Option<String>,
    pub date_added_ms: Option<i64>,
    pub date_created_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Query {
    pub folder_prefix: Option<String>,
    pub text: Option<String>,
    pub tag_path: Option<String>,
    #[serde(default)]
    pub tag_paths: Vec<String>,
    pub bpm_min: Option<f64>,
    pub bpm_max: Option<f64>,
    pub key: Option<String>,
    pub sample_type: Option<String>,
    #[serde(default)]
    pub half_double: bool,
    #[serde(default)]
    pub relative_key: bool,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub sort_column: String,
    #[serde(default)]
    pub sort_direction: String,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn sample_to_dto(s: Sample) -> SampleDto {
    SampleDto {
        id: id_to_i64(s.id),
        root_id: id_to_i64(s.root_id),
        path: s.path,
        filename: s.filename,
        parent_path: s.parent_path,
        extension: s.extension,
        size_bytes: s.size_bytes,
        missing: s.missing != 0,
        availability: s.availability,
        sample_rate: s.sample_rate.map(id_to_i64),
        bit_depth: s.bit_depth.map(id_to_i64),
        channels: s.channels.map(id_to_i64),
        duration_ms: s.duration_ms,
        format: s.format,
        // BPM ≤ 0 is "no BPM" (same as null).
        bpm: s.bpm.filter(|b| *b > 0.0),
        key_name: s.key_name,
        sample_type: s.sample_type,
        favorite: s.favorite != 0,
        tags: Vec::new(),
        catalog_source: s.catalog_source,
        bpm_source: s.bpm_source,
        key_source: s.key_source,
        sample_type_source: s.sample_type_source,
        date_added_ms: s.date_added_ms,
        date_created_ms: s.date_created_ms,
    }
}

fn order_sql(sort_column: &str, sort_direction: &str) -> &'static str {
    let cleared = sort_direction.eq_ignore_ascii_case("clear")
        || sort_direction.is_empty()
        || sort_column.is_empty();
    if cleared {
        return "filename COLLATE NOCASE ASC";
    }
    let desc = sort_direction.eq_ignore_ascii_case("desc");
    match sort_column {
        "name" => {
            if desc {
                "filename COLLATE NOCASE DESC"
            } else {
                "filename COLLATE NOCASE ASC"
            }
        }
        "type" => {
            if desc {
                "sample_type COLLATE NOCASE DESC NULLS LAST"
            } else {
                "sample_type COLLATE NOCASE ASC NULLS LAST"
            }
        }
        "bpm" => {
            if desc {
                "bpm DESC NULLS LAST"
            } else {
                "bpm ASC NULLS LAST"
            }
        }
        "key" => {
            if desc {
                "key_name COLLATE NOCASE DESC NULLS LAST"
            } else {
                "key_name COLLATE NOCASE ASC NULLS LAST"
            }
        }
        "created_at" => {
            if desc {
                "created_at DESC"
            } else {
                "created_at ASC"
            }
        }
        "date_added" => {
            if desc {
                "date_added_ms DESC NULLS LAST"
            } else {
                "date_added_ms ASC NULLS LAST"
            }
        }
        "date_created" => {
            if desc {
                "date_created_ms DESC NULLS LAST"
            } else {
                "date_created_ms ASC NULLS LAST"
            }
        }
        "favorite" => {
            if desc {
                "favorite DESC, filename COLLATE NOCASE ASC"
            } else {
                "favorite ASC, filename COLLATE NOCASE ASC"
            }
        }
        _ => "filename COLLATE NOCASE ASC",
    }
}

fn load_tags_for(conn: &mut SqliteConnection, samples: &mut [SampleDto]) -> AppResult<()> {
    if samples.is_empty() {
        return Ok(());
    }
    let ids: Vec<i32> = samples
        .iter()
        .map(|s| id_from_i64(s.id))
        .collect::<AppResult<_>>()?;
    let rows: Vec<(i32, i32, String, Option<String>)> = sample_tags_dsl::sample_tags
        .inner_join(tags_dsl::tags)
        .filter(sample_tags_dsl::sample_id.eq_any(&ids))
        .select((
            sample_tags_dsl::sample_id,
            tags_dsl::id,
            tags_dsl::path,
            tags_dsl::color,
        ))
        .order(tags_dsl::path.asc())
        .load(conn)?;

    let mut by_id: HashMap<i64, Vec<TagChip>> = HashMap::new();
    for (sample_id, tag_id, path, stored_color) in rows {
        let color = stored_color.or_else(|| {
            crate::tags::resolve_color(conn, id_to_i64(tag_id))
                .ok()
                .flatten()
        });
        by_id
            .entry(id_to_i64(sample_id))
            .or_default()
            .push(TagChip {
                id: id_to_i64(tag_id),
                path,
                color,
            });
    }
    for sample in samples.iter_mut() {
        if let Some(tags) = by_id.remove(&sample.id) {
            sample.tags = tags;
        }
    }
    Ok(())
}

/// Split a search string into words. Spaces and the separators common in
/// sample names (`_`, `-`, `.`) all count as word breaks.
fn search_tokens(text: &str) -> Vec<String> {
    text.split(|c: char| c.is_whitespace() || matches!(c, '_' | '-' | '.'))
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Escape `LIKE` wildcards so `%` and `_` in a search word match literally.
fn escape_like(token: &str) -> String {
    let mut out = String::with_capacity(token.len());
    for c in token.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

pub fn list_samples(conn: &mut SqliteConnection, query: &Query) -> AppResult<Vec<SampleDto>> {
    let mut q = samples_dsl::samples
        .select(Sample::as_select())
        .into_boxed();

    if let Some(prefix) = query.folder_prefix.as_deref().filter(|s| !s.is_empty()) {
        let like = format!("{prefix}{}%", std::path::MAIN_SEPARATOR);
        q = q.filter(
            samples_dsl::parent_path
                .eq(prefix)
                .or(samples_dsl::parent_path.like(like)),
        );
    }

    // Every word must appear somewhere in the filename, in any order:
    // "cw amen", "amen cw" and "cw am" all match "cw_amen_chopper.wav".
    if let Some(text) = query.text.as_deref() {
        for token in search_tokens(text) {
            q = q.filter(
                samples_dsl::filename
                    .like(format!("%{}%", escape_like(&token)))
                    .escape('\\'),
            );
        }
    }

    let mut tag_filters: Vec<String> = query
        .tag_paths
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect();
    if tag_filters.is_empty()
        && let Some(tag_path) = query.tag_path.as_deref().filter(|s| !s.is_empty())
    {
        tag_filters.push(tag_path.to_string());
    }
    for tag_path in &tag_filters {
        let like = format!("{tag_path}/%");
        let tp = tag_path.clone();
        q = q.filter(exists(
            sample_tags_dsl::sample_tags
                .inner_join(tags_dsl::tags)
                .filter(sample_tags_dsl::sample_id.eq(samples_dsl::id))
                .filter(tags_dsl::path.eq(tp).or(tags_dsl::path.like(like))),
        ));
    }

    if query.bpm_min.is_some() || query.bpm_max.is_some() {
        let min = query.bpm_min.unwrap_or(0.0);
        let max = query.bpm_max.unwrap_or(f64::MAX);
        if query.half_double {
            q = q.filter(
                samples_dsl::bpm.is_not_null().and(
                    samples_dsl::bpm
                        .ge(min)
                        .and(samples_dsl::bpm.le(max))
                        .or(samples_dsl::bpm
                            .ge(min / 2.0)
                            .and(samples_dsl::bpm.le(max / 2.0)))
                        .or(samples_dsl::bpm
                            .ge(min * 2.0)
                            .and(samples_dsl::bpm.le(max * 2.0))),
                ),
            );
        } else {
            q = q.filter(
                samples_dsl::bpm
                    .is_not_null()
                    .and(samples_dsl::bpm.ge(min))
                    .and(samples_dsl::bpm.le(max)),
            );
        }
    }

    if let Some(key) = query.key.as_deref().filter(|s| !s.is_empty()) {
        let keys = key_match_set(key, query.relative_key);
        if !keys.is_empty() {
            // Keys are controlled pitch tokens (a-z / # / m); safe to embed.
            let list = keys
                .iter()
                .map(|k| format!("'{k}'"))
                .collect::<Vec<_>>()
                .join(", ");
            q = q.filter(sql::<Bool>(&format!(
                "key_name IS NOT NULL AND lower(replace(key_name, ' ', '')) IN ({list})"
            )));
        }
    }

    if let Some(sample_type) = query.sample_type.as_deref().filter(|s| !s.is_empty()) {
        // Escape single quotes if any; sample_type is user filter text.
        let escaped = sample_type.replace('\'', "''");
        q = q.filter(sql::<Bool>(&format!(
            "sample_type = '{escaped}' COLLATE NOCASE"
        )));
    }

    if query.favorites_only {
        q = q.filter(samples_dsl::favorite.eq(1));
    }

    let order = order_sql(&query.sort_column, &query.sort_direction);
    q = q.order(sql::<Text>(order));

    if let Some(limit) = query.limit {
        q = q.limit(limit);
        if let Some(offset) = query.offset {
            q = q.offset(offset);
        }
    } else if let Some(offset) = query.offset {
        q = q.limit(i64::MAX).offset(offset);
    }

    let rows: Vec<Sample> = q.load(conn)?;
    let mut samples: Vec<SampleDto> = rows.into_iter().map(sample_to_dto).collect();
    load_tags_for(conn, &mut samples)?;
    Ok(samples)
}

/// Normalized lowercase key tokens that should match `key` (enharmonics + optional relatives).
fn key_match_set(key: &str, relative: bool) -> Vec<String> {
    let normalized = normalize_key_token(key);
    if normalized.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: String| {
        if !out.iter().any(|x| x == &s) {
            out.push(s);
        }
    };

    for equiv in enharmonic_forms(&normalized) {
        push(equiv.clone());
        if relative && let Some(rel) = relative_of(&equiv) {
            for e in enharmonic_forms(&rel) {
                push(e);
            }
        }
    }
    out
}

fn normalize_key_token(raw: &str) -> String {
    let s = raw.trim().to_lowercase().replace(' ', "");
    let s = s
        .replace("major", "")
        .replace("maj", "")
        .replace("minor", "m")
        .replace("min", "m");
    s.replace("♯", "#").replace("♭", "b")
}

fn parse_root_mode(key: &str) -> Option<(String, bool)> {
    let k = normalize_key_token(key);
    if k.is_empty() {
        return None;
    }
    let (root, minor) = k.strip_suffix('m').map_or_else(
        || (k.clone(), false),
        |stripped| (stripped.to_string(), true),
    );
    if root.is_empty() {
        return None;
    }
    Some((root, minor))
}

fn pitch_class(root: &str) -> Option<u8> {
    match root {
        "c" => Some(0),
        "c#" | "db" => Some(1),
        "d" => Some(2),
        "d#" | "eb" => Some(3),
        "e" | "fb" => Some(4),
        "f" | "e#" => Some(5),
        "f#" | "gb" => Some(6),
        "g" => Some(7),
        "g#" | "ab" => Some(8),
        "a" => Some(9),
        "a#" | "bb" => Some(10),
        "b" | "cb" => Some(11),
        _ => None,
    }
}

const fn spellings_for(pc: u8) -> &'static [&'static str] {
    match pc {
        0 => &["c", "b#"],
        1 => &["c#", "db"],
        2 => &["d"],
        3 => &["d#", "eb"],
        4 => &["e", "fb"],
        5 => &["f", "e#"],
        6 => &["f#", "gb"],
        7 => &["g"],
        8 => &["g#", "ab"],
        9 => &["a"],
        10 => &["a#", "bb"],
        11 => &["b", "cb"],
        _ => &[],
    }
}

fn enharmonic_forms(key: &str) -> Vec<String> {
    let Some((root, minor)) = parse_root_mode(key) else {
        return vec![normalize_key_token(key)];
    };
    let Some(pc) = pitch_class(&root) else {
        return vec![normalize_key_token(key)];
    };
    spellings_for(pc)
        .iter()
        .map(|sp| {
            if minor {
                format!("{sp}m")
            } else {
                (*sp).to_string()
            }
        })
        .collect()
}

fn relative_of(key: &str) -> Option<String> {
    let (root, minor) = parse_root_mode(key)?;
    let pc = pitch_class(&root)?;
    let rel_pc = if minor {
        pc.wrapping_add(3).wrapping_rem(12)
    } else {
        pc.wrapping_add(9).wrapping_rem(12)
    };
    let spelling = spellings_for(rel_pc).first()?;
    Some(if minor {
        (*spelling).to_string()
    } else {
        format!("{spelling}m")
    })
}

pub fn set_sample_favorite(conn: &mut SqliteConnection, id: i64, favorite: bool) -> AppResult<()> {
    let n = diesel::update(samples_dsl::samples.find(id_from_i64(id)?))
        .set((
            samples_dsl::favorite.eq(i32::from(favorite)),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    if n == 0 {
        return Err(crate::error::AppError::msg("sample not found"));
    }
    Ok(())
}

/// Rows (with tags) for the given ids, in no particular order. Missing ids are skipped.
/// The UI uses this to patch rows in place instead of refetching the list.
pub fn get_samples(conn: &mut SqliteConnection, ids: &[i64]) -> AppResult<Vec<SampleDto>> {
    let mut out: Vec<SampleDto> = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(500) {
        let ids_i32: Vec<i32> = chunk
            .iter()
            .filter_map(|&id| id_from_i64(id).ok())
            .collect();
        let rows: Vec<Sample> = samples_dsl::samples
            .filter(samples_dsl::id.eq_any(&ids_i32))
            .select(Sample::as_select())
            .load(conn)?;
        out.extend(rows.into_iter().map(sample_to_dto));
    }
    load_tags_for(conn, &mut out)?;
    Ok(out)
}

pub fn get_sample(conn: &mut SqliteConnection, id: i64) -> AppResult<Option<SampleDto>> {
    let row: Option<Sample> = samples_dsl::samples
        .find(id_from_i64(id)?)
        .select(Sample::as_select())
        .first(conn)
        .optional()?;
    let mut sample = row.map(sample_to_dto);
    if let Some(ref mut s) = sample {
        load_tags_for(conn, std::slice::from_mut(s))?;
    }
    Ok(sample)
}

pub fn get_sample_by_path(conn: &mut SqliteConnection, path: &str) -> AppResult<Option<SampleDto>> {
    let row: Option<Sample> = samples_dsl::samples
        .filter(samples_dsl::path.eq(path))
        .select(Sample::as_select())
        .first(conn)
        .optional()?;
    let mut sample = row.map(sample_to_dto);
    if let Some(ref mut s) = sample {
        load_tags_for(conn, std::slice::from_mut(s))?;
    }
    Ok(sample)
}

pub fn mark_missing(conn: &mut SqliteConnection, path: &str) -> AppResult<bool> {
    let now = utc_now();
    let n = diesel::update(
        samples_dsl::samples
            .filter(samples_dsl::path.eq(path))
            .filter(samples_dsl::missing.eq(0)),
    )
    .set((
        samples_dsl::missing.eq(1),
        samples_dsl::availability.eq(Availability::Missing.as_str()),
        samples_dsl::availability_checked_at.eq(Some(now.as_str())),
        samples_dsl::updated_at.eq(now.as_str()),
    ))
    .execute(conn)?;
    Ok(n > 0)
}

/// Result of re-statting sample paths for `availability` (no decode / open).
#[derive(Debug, Clone, Default)]
pub struct AvailabilityRefresh {
    /// Rows whose `availability` or `missing` flag changed.
    pub updated: u64,
    /// Ids that moved from non-`local` → `local` (candidates for analyze).
    pub became_local_ids: Vec<i64>,
}

/// Outcome of a watch-driven technical refresh for one path.
#[derive(Debug, Clone)]
pub struct TechnicalRefresh {
    pub sample_id: i64,
    /// Size/mtime/missing/availability changed enough for the UI to reload.
    pub changed: bool,
    /// Flipped to on-disk local bytes (hydrate or first classify).
    pub became_local: bool,
    /// Local file whose size or mtime changed: its peakfile and technical
    /// fields are stale and it needs a trip through the analyze queue.
    pub content_changed: bool,
}

#[must_use]
fn stored_is_local(availability: &str) -> bool {
    availability == Availability::Local.as_str()
}

fn apply_availability_update(
    conn: &mut SqliteConnection,
    id: i32,
    old_availability: &str,
    old_missing: i32,
    avail: Availability,
) -> AppResult<Option<(bool, bool)>> {
    let now = utc_now();
    let missing_flag = i32::from(avail == Availability::Missing);
    let avail_s = avail.as_str();
    if old_availability == avail_s && old_missing == missing_flag {
        return Ok(None);
    }
    diesel::update(samples_dsl::samples.find(id))
        .set((
            samples_dsl::availability.eq(avail_s),
            samples_dsl::availability_checked_at.eq(Some(now.as_str())),
            samples_dsl::missing.eq(missing_flag),
            samples_dsl::updated_at.eq(now.as_str()),
        ))
        .execute(conn)?;
    let became_local = !stored_is_local(old_availability) && avail == Availability::Local;
    Ok(Some((true, became_local)))
}

/// Re-stat paths (no decode) and update `availability`.
///
/// The `stat` calls run without the DB lock: on Dropbox File Provider paths
/// they can take hundreds of ms in total, and the UI and analyze workers share
/// that lock.
pub fn refresh_availability_for_paths(
    db: &crate::db::Db,
    paths: &[String],
) -> AppResult<AvailabilityRefresh> {
    let mut rows: Vec<(i32, String, String, i32)> = Vec::with_capacity(paths.len());
    db.with_conn(|conn| {
        for chunk in paths.chunks(500) {
            let found: Vec<(i32, String, String, i32)> = samples_dsl::samples
                .filter(samples_dsl::path.eq_any(chunk))
                .select((
                    samples_dsl::id,
                    samples_dsl::path,
                    samples_dsl::availability,
                    samples_dsl::missing,
                ))
                .load(conn)?;
            rows.extend(found);
        }
        Ok(())
    })?;
    apply_classified(db, classify_rows(rows))
}

/// `stat` each row's path. No DB access.
fn classify_rows(rows: Vec<(i32, String, String, i32)>) -> Vec<(i32, String, i32, Availability)> {
    rows.into_iter()
        .map(|(id, path, old_avail, old_missing)| {
            let avail = fs_ready::classify_path(std::path::Path::new(&path));
            (id, old_avail, old_missing, avail)
        })
        .collect()
}

/// Write changed availability rows in one short transaction.
fn apply_classified(
    db: &crate::db::Db,
    classified: Vec<(i32, String, i32, Availability)>,
) -> AppResult<AvailabilityRefresh> {
    let mut out = AvailabilityRefresh::default();
    db.with_conn(|conn| {
        conn.transaction::<_, AppError, _>(|conn| {
            for (id, old_avail, old_missing, avail) in &classified {
                if let Some((changed, became_local)) =
                    apply_availability_update(conn, *id, old_avail, *old_missing, *avail)?
                {
                    if changed {
                        out.updated = out.updated.saturating_add(1);
                    }
                    if became_local {
                        out.became_local_ids.push(id_to_i64(*id));
                    }
                }
            }
            Ok(())
        })
    })?;
    Ok(out)
}

/// Re-stat every sample path (metadata only). For launch backfill after schema add
/// or while a cloud provider is still hydrating.
///
/// When `app` is set, drives the bottom-right work bar.
pub fn refresh_availability_all(
    db: &crate::db::Db,
    app: Option<&tauri::AppHandle>,
) -> AppResult<AvailabilityRefresh> {
    let rows: Vec<(i32, String, String, i32)> = db.with_conn(|conn| {
        Ok(samples_dsl::samples
            .select((
                samples_dsl::id,
                samples_dsl::path,
                samples_dsl::availability,
                samples_dsl::missing,
            ))
            .load(conn)?)
    })?;
    let total = u64::try_from(rows.len()).unwrap_or(u64::MAX);
    if let Some(app) = app {
        crate::analyze::work::start(app, total);
    }
    let mut classified = Vec::with_capacity(rows.len());
    for (i, (id, path, old_avail, old_missing)) in rows.into_iter().enumerate() {
        let avail = fs_ready::classify_path(std::path::Path::new(&path));
        classified.push((id, old_avail, old_missing, avail));
        if let Some(app) = app {
            let done = u64::try_from(i.saturating_add(1)).unwrap_or(u64::MAX);
            if done == total || done.is_multiple_of(50) {
                crate::analyze::work::tick(app, done, total, id_to_i64(id));
            }
        }
    }
    if let Some(app) = app {
        crate::analyze::work::finish(app, total);
    }
    apply_classified(db, classified)
}

pub fn remove_sample(conn: &mut SqliteConnection, id: i64) -> AppResult<()> {
    let n = diesel::delete(samples_dsl::samples.find(id_from_i64(id)?)).execute(conn)?;
    if n == 0 {
        return Err(crate::error::AppError::msg("sample not found"));
    }
    Ok(())
}

pub fn purge_missing(conn: &mut SqliteConnection) -> AppResult<u64> {
    let n =
        diesel::delete(samples_dsl::samples.filter(samples_dsl::missing.eq(1))).execute(conn)?;
    u64::try_from(n).map_err(|_| AppError::msg("purge count out of range"))
}

pub fn update_path(conn: &mut SqliteConnection, from: &str, to: &str) -> AppResult<bool> {
    use std::path::Path;
    let path = Path::new(to);
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let parent = path
        .parent()
        .map_or_default(|p| p.to_string_lossy().to_string());
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let n = diesel::update(samples_dsl::samples.filter(samples_dsl::path.eq(from)))
        .set((
            samples_dsl::path.eq(to),
            samples_dsl::filename.eq(filename),
            samples_dsl::parent_path.eq(parent),
            samples_dsl::extension.eq(extension),
            samples_dsl::missing.eq(0),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    Ok(n > 0)
}

/// Refresh size/mtime/inode and availability. Keeps bpm/key/tags/type.
///
/// Holds the DB lock only for the reads and writes; `stat` runs without it.
/// Local files whose content changed come back with `content_changed` so the
/// caller can queue them for analysis.
pub fn refresh_technical(db: &crate::db::Db, path: &str) -> AppResult<Option<TechnicalRefresh>> {
    use std::fs;
    use std::path::Path;
    use std::time::SystemTime;

    type ExistingRow = (i32, Option<i64>, Option<i64>, String, i32);
    let existing: Option<ExistingRow> = db.with_conn(|conn| {
        Ok(samples_dsl::samples
            .filter(samples_dsl::path.eq(path))
            .select((
                samples_dsl::id,
                samples_dsl::size_bytes,
                samples_dsl::mtime_ms,
                samples_dsl::availability,
                samples_dsl::missing,
            ))
            .first(conn)
            .optional()?)
    })?;
    let Some((id, old_size, old_mtime, old_avail, old_missing)) = existing else {
        return Ok(None);
    };
    let sample_id = id_to_i64(id);

    let path_buf = Path::new(path);
    let Ok(meta) = fs::metadata(path_buf) else {
        let marked = db.with_conn(|conn| mark_missing(conn, path))?;
        return Ok(Some(TechnicalRefresh {
            sample_id,
            changed: marked,
            became_local: false,
            content_changed: false,
        }));
    };
    let size = i64::try_from(meta.len()).unwrap_or(i64::MAX);
    let mtime = meta.modified().ok().and_then(|t| {
        t.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .and_then(|d| i64::try_from(d.as_millis()).ok())
    });
    #[cfg(unix)]
    let inode = {
        use std::os::unix::fs::MetadataExt;
        i64::try_from(meta.ino()).ok()
    };
    #[cfg(not(unix))]
    let inode: Option<i64> = None;
    let date_created = crate::fs_dates::date_created_ms(&meta);
    let date_added = crate::fs_dates::date_added_ms(path_buf);
    let avail = fs_ready::classify_meta(&meta);
    let now = utc_now();
    let missing_flag = i32::from(avail == Availability::Missing);
    let became_local = !stored_is_local(&old_avail) && avail == Availability::Local;
    let avail_changed = old_avail != avail.as_str() || old_missing != missing_flag;

    if old_size == Some(size) && old_mtime == mtime {
        db.with_conn(|conn| {
            diesel::update(samples_dsl::samples.find(id))
                .set((
                    samples_dsl::missing.eq(missing_flag),
                    samples_dsl::availability.eq(avail.as_str()),
                    samples_dsl::availability_checked_at.eq(Some(now.as_str())),
                    samples_dsl::date_added_ms.eq(date_added),
                    samples_dsl::date_created_ms.eq(date_created),
                ))
                .execute(conn)?;
            Ok(())
        })?;
        return Ok(Some(TechnicalRefresh {
            sample_id,
            changed: avail_changed,
            became_local,
            content_changed: false,
        }));
    }

    db.with_conn(|conn| {
        diesel::update(samples_dsl::samples.find(id))
            .set((
                samples_dsl::size_bytes.eq(Some(size)),
                samples_dsl::mtime_ms.eq(mtime),
                samples_dsl::inode.eq(inode),
                samples_dsl::missing.eq(missing_flag),
                samples_dsl::availability.eq(avail.as_str()),
                samples_dsl::availability_checked_at.eq(Some(now.as_str())),
                samples_dsl::date_added_ms.eq(date_added),
                samples_dsl::date_created_ms.eq(date_created),
                samples_dsl::updated_at.eq(now.as_str()),
            ))
            .execute(conn)?;
        Ok(())
    })?;
    // No decode here: the caller sends changed local files through the
    // analyze queue (status bar shows it). Cloud placeholders are never decoded.
    Ok(Some(TechnicalRefresh {
        sample_id,
        changed: true,
        became_local,
        content_changed: avail == Availability::Local,
    }))
}

pub fn set_sample_bpm(conn: &mut SqliteConnection, id: i64, bpm: Option<f64>) -> AppResult<()> {
    // 0 and negatives mean "no BPM" (clear). Clearing is a user choice.
    let bpm = bpm.filter(|b| *b > 0.0);
    let n = diesel::update(samples_dsl::samples.find(id_from_i64(id)?))
        .set((
            samples_dsl::bpm.eq(bpm),
            samples_dsl::bpm_source.eq(Some("user")),
            samples_dsl::bpm_confidence.eq(Some(1.0)),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    if n == 0 {
        return Err(crate::error::AppError::msg("sample not found"));
    }
    Ok(())
}

pub fn set_sample_key(conn: &mut SqliteConnection, id: i64, key: Option<&str>) -> AppResult<()> {
    let n = diesel::update(samples_dsl::samples.find(id_from_i64(id)?))
        .set((
            samples_dsl::key_name.eq(key),
            samples_dsl::key_source.eq(key.map(|_| "user")),
            samples_dsl::key_confidence.eq(key.map(|_| 1.0)),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    if n == 0 {
        return Err(crate::error::AppError::msg("sample not found"));
    }
    Ok(())
}

pub fn set_sample_type(
    conn: &mut SqliteConnection,
    id: i64,
    sample_type: Option<&str>,
) -> AppResult<()> {
    let n = diesel::update(samples_dsl::samples.find(id_from_i64(id)?))
        .set((
            samples_dsl::sample_type.eq(sample_type),
            samples_dsl::sample_type_source.eq(sample_type.map(|_| "user")),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    if n == 0 {
        return Err(crate::error::AppError::msg("sample not found"));
    }
    Ok(())
}

/// Wipe creative analysis fields for the whole library (nuclear reset).
/// Keeps favorites, user tags, tag rejects, roots, and UI prefs.
/// Returns ids of local samples that should be re-queued for full analyze.
pub fn wipe_analysis_all(
    conn: &mut SqliteConnection,
    peaks_dir: &std::path::Path,
) -> AppResult<Vec<i64>> {
    use crate::db::schema::sample_tags::dsl as sample_tags_dsl;
    use std::fs;

    diesel::update(samples_dsl::samples)
        .set((
            samples_dsl::bpm.eq(Option::<f64>::None),
            samples_dsl::bpm_confidence.eq(Option::<f64>::None),
            samples_dsl::key_name.eq(Option::<String>::None),
            samples_dsl::key_confidence.eq(Option::<f64>::None),
            samples_dsl::sample_type.eq(Option::<String>::None),
            samples_dsl::catalog_source.eq(Option::<String>::None),
            samples_dsl::bpm_source.eq(Option::<String>::None),
            samples_dsl::key_source.eq(Option::<String>::None),
            samples_dsl::sample_type_source.eq(Option::<String>::None),
            samples_dsl::analyzed_at.eq(Option::<String>::None),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;

    diesel::delete(sample_tags_dsl::sample_tags.filter(sample_tags_dsl::source.eq("auto")))
        .execute(conn)?;

    if peaks_dir.is_dir() {
        for entry in fs::read_dir(peaks_dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("peaks") {
                let _ = fs::remove_file(path);
            }
        }
    }

    let ids: Vec<i32> = samples_dsl::samples
        .filter(samples_dsl::missing.eq(0))
        .filter(samples_dsl::availability.eq(Availability::Local.as_str()))
        .select(samples_dsl::id)
        .load(conn)?;
    Ok(ids.into_iter().map(id_to_i64).collect())
}

/// `(favorite, bpm, key_name, sample_type)` as stored for one sample.
pub type SampleMeta = (bool, Option<f64>, Option<String>, Option<String>);

pub fn sample_meta_snapshot(conn: &mut SqliteConnection, id: i64) -> AppResult<SampleMeta> {
    samples_dsl::samples
        .find(id_from_i64(id)?)
        .select((
            samples_dsl::favorite,
            samples_dsl::bpm,
            samples_dsl::key_name,
            samples_dsl::sample_type,
        ))
        .first::<(i32, Option<f64>, Option<String>, Option<String>)>(conn)
        .map(|(fav, bpm, key, ty)| (fav != 0, bpm, key, ty))
        .map_err(|_| crate::error::AppError::msg("sample not found"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::roots::dsl as roots_dsl;

    fn seed(conn: &mut SqliteConnection) -> Vec<i64> {
        diesel::insert_into(roots_dsl::roots)
            .values((roots_dsl::path.eq("/lib"), roots_dsl::label.eq("lib")))
            .execute(conn)
            .unwrap();
        let root_id: i32 = roots_dsl::roots.select(roots_dsl::id).first(conn).unwrap();
        for name in ["a.wav", "b.wav", "c.wav"] {
            diesel::insert_into(samples_dsl::samples)
                .values((
                    samples_dsl::root_id.eq(root_id),
                    samples_dsl::path.eq(format!("/lib/{name}")),
                    samples_dsl::filename.eq(name),
                    samples_dsl::parent_path.eq("/lib"),
                    samples_dsl::extension.eq("wav"),
                ))
                .execute(conn)
                .unwrap();
        }
        samples_dsl::samples
            .select(samples_dsl::id)
            .order(samples_dsl::id.asc())
            .load::<i32>(conn)
            .unwrap()
            .into_iter()
            .map(id_to_i64)
            .collect()
    }

    #[test]
    fn get_samples_returns_requested_rows() {
        let mut conn = crate::db::test_conn();
        let ids = seed(&mut conn);
        let want = [ids[0], ids[2], 9_999];
        let mut got: Vec<i64> = get_samples(&mut conn, &want)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        got.sort_unstable();
        assert_eq!(got, vec![ids[0], ids[2]]);
    }

    fn search(conn: &mut SqliteConnection, text: &str) -> Vec<String> {
        let query: Query = serde_json::from_value(serde_json::json!({
            "folder_prefix": null,
            "text": text,
            "tag_path": null,
            "bpm_min": null,
            "bpm_max": null,
            "key": null,
            "sample_type": null,
            "limit": null,
            "offset": null,
        }))
        .unwrap();
        let mut names: Vec<String> = list_samples(conn, &query)
            .unwrap()
            .into_iter()
            .map(|s| s.filename)
            .collect();
        names.sort();
        names
    }

    #[test]
    fn search_matches_words_in_any_order() {
        let mut conn = crate::db::test_conn();
        diesel::insert_into(roots_dsl::roots)
            .values((roots_dsl::path.eq("/lib"), roots_dsl::label.eq("lib")))
            .execute(&mut conn)
            .unwrap();
        let root_id: i32 = roots_dsl::roots
            .select(roots_dsl::id)
            .first(&mut conn)
            .unwrap();
        for name in [
            "cw_amen_chopper.wav",
            "Amen-Break 170.wav",
            "cwkick.wav",
            "50%_snare.wav",
        ] {
            diesel::insert_into(samples_dsl::samples)
                .values((
                    samples_dsl::root_id.eq(root_id),
                    samples_dsl::path.eq(format!("/lib/{name}")),
                    samples_dsl::filename.eq(name),
                    samples_dsl::parent_path.eq("/lib"),
                    samples_dsl::extension.eq("wav"),
                ))
                .execute(&mut conn)
                .unwrap();
        }
        let chopper = vec!["cw_amen_chopper.wav".to_string()];
        assert_eq!(search(&mut conn, "cw amen"), chopper);
        assert_eq!(search(&mut conn, "amen cw"), chopper);
        assert_eq!(search(&mut conn, "cw am"), chopper);
        assert_eq!(search(&mut conn, "CW_AMEN"), chopper);
        assert_eq!(
            search(&mut conn, "amen"),
            vec![
                "Amen-Break 170.wav".to_string(),
                "cw_amen_chopper.wav".to_string()
            ]
        );
        // `%` is literal, not a wildcard.
        assert_eq!(search(&mut conn, "50%"), vec!["50%_snare.wav".to_string()]);
        // Blank input does not filter.
        assert_eq!(search(&mut conn, "  ").len(), 4);
    }

    #[test]
    fn get_samples_empty_input() {
        let mut conn = crate::db::test_conn();
        assert!(get_samples(&mut conn, &[]).unwrap().is_empty());
    }
}
