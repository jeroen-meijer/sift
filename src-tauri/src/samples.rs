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
use crate::ids::{id_from_i64, id_to_i64};

#[derive(Debug, Clone, Serialize)]
pub struct TagChip {
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
    pub missing: bool,
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
        missing: s.missing != 0,
        sample_rate: s.sample_rate.map(id_to_i64),
        bit_depth: s.bit_depth.map(id_to_i64),
        channels: s.channels.map(id_to_i64),
        duration_ms: s.duration_ms,
        format: s.format,
        bpm: s.bpm,
        key_name: s.key_name,
        sample_type: s.sample_type,
        favorite: s.favorite != 0,
        tags: Vec::new(),
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
            .push(TagChip { path, color });
    }
    for sample in samples.iter_mut() {
        if let Some(tags) = by_id.remove(&sample.id) {
            sample.tags = tags;
        }
    }
    Ok(())
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

    if let Some(text) = query.text.as_deref().filter(|s| !s.is_empty()) {
        q = q.filter(samples_dsl::filename.like(format!("%{text}%")));
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
    let n = diesel::update(
        samples_dsl::samples
            .filter(samples_dsl::path.eq(path))
            .filter(samples_dsl::missing.eq(0)),
    )
    .set((
        samples_dsl::missing.eq(1),
        samples_dsl::updated_at.eq(utc_now()),
    ))
    .execute(conn)?;
    Ok(n > 0)
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
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
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

/// Refresh size/mtime/inode (+ probe technical audio fields). Keeps bpm/key/tags/type.
pub fn refresh_technical(conn: &mut SqliteConnection, path: &str) -> AppResult<bool> {
    use std::fs;
    use std::path::Path;
    use std::time::SystemTime;

    let path_buf = Path::new(path);
    let Ok(meta) = fs::metadata(path_buf) else {
        mark_missing(conn, path)?;
        return Ok(false);
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

    let existing: Option<(i32, Option<i64>, Option<i64>)> = samples_dsl::samples
        .filter(samples_dsl::path.eq(path))
        .select((
            samples_dsl::id,
            samples_dsl::size_bytes,
            samples_dsl::mtime_ms,
        ))
        .first(conn)
        .optional()?;

    let Some((id, old_size, old_mtime)) = existing else {
        return Ok(false);
    };
    if old_size == Some(size) && old_mtime == mtime {
        diesel::update(samples_dsl::samples.find(id))
            .set(samples_dsl::missing.eq(0))
            .execute(conn)?;
        return Ok(false);
    }

    diesel::update(samples_dsl::samples.find(id))
        .set((
            samples_dsl::size_bytes.eq(Some(size)),
            samples_dsl::mtime_ms.eq(mtime),
            samples_dsl::inode.eq(inode),
            samples_dsl::missing.eq(0),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    let _ = crate::audio::probe_and_update_sample(conn, id_to_i64(id), path_buf);
    Ok(true)
}

pub fn set_sample_bpm(conn: &mut SqliteConnection, id: i64, bpm: Option<f64>) -> AppResult<()> {
    let n = diesel::update(samples_dsl::samples.find(id_from_i64(id)?))
        .set((
            samples_dsl::bpm.eq(bpm),
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
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;
    if n == 0 {
        return Err(crate::error::AppError::msg("sample not found"));
    }
    Ok(())
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
