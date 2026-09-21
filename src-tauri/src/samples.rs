use std::collections::HashMap;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

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

fn row_to_sample(row: &rusqlite::Row<'_>) -> rusqlite::Result<SampleDto> {
    Ok(SampleDto {
        id: row.get(0)?,
        root_id: row.get(1)?,
        path: row.get(2)?,
        filename: row.get(3)?,
        parent_path: row.get(4)?,
        extension: row.get(5)?,
        missing: row.get::<_, i64>(6)? != 0,
        sample_rate: row.get(7)?,
        bit_depth: row.get(8)?,
        channels: row.get(9)?,
        duration_ms: row.get(10)?,
        format: row.get(11)?,
        bpm: row.get(12)?,
        key_name: row.get(13)?,
        sample_type: row.get(14)?,
        favorite: row.get::<_, i64>(15)? != 0,
        tags: Vec::new(),
    })
}

const SAMPLE_SELECT: &str = r#"
    SELECT id, root_id, path, filename, parent_path, extension, missing,
           sample_rate, bit_depth, channels, duration_ms, format, bpm,
           key_name, sample_type, favorite
    FROM samples
"#;

fn order_clause(sort_column: &str, sort_direction: &str) -> &'static str {
    let cleared = sort_direction.eq_ignore_ascii_case("clear")
        || sort_direction.is_empty()
        || sort_column.is_empty();
    if cleared {
        return "ORDER BY filename COLLATE NOCASE ASC";
    }
    let desc = sort_direction.eq_ignore_ascii_case("desc");
    match sort_column {
        "name" => {
            if desc {
                "ORDER BY filename COLLATE NOCASE DESC"
            } else {
                "ORDER BY filename COLLATE NOCASE ASC"
            }
        }
        "type" => {
            if desc {
                "ORDER BY sample_type COLLATE NOCASE DESC NULLS LAST"
            } else {
                "ORDER BY sample_type COLLATE NOCASE ASC NULLS LAST"
            }
        }
        "bpm" => {
            if desc {
                "ORDER BY bpm DESC NULLS LAST"
            } else {
                "ORDER BY bpm ASC NULLS LAST"
            }
        }
        "key" => {
            if desc {
                "ORDER BY key_name COLLATE NOCASE DESC NULLS LAST"
            } else {
                "ORDER BY key_name COLLATE NOCASE ASC NULLS LAST"
            }
        }
        "created_at" => {
            if desc {
                "ORDER BY created_at DESC"
            } else {
                "ORDER BY created_at ASC"
            }
        }
        "favorite" => {
            if desc {
                "ORDER BY favorite DESC, filename COLLATE NOCASE ASC"
            } else {
                "ORDER BY favorite ASC, filename COLLATE NOCASE ASC"
            }
        }
        _ => "ORDER BY filename COLLATE NOCASE ASC",
    }
}

fn load_tags_for(
    conn: &Connection,
    samples: &mut [SampleDto],
) -> AppResult<()> {
    if samples.is_empty() {
        return Ok(());
    }
    let ids: Vec<i64> = samples.iter().map(|s| s.id).collect();
    let placeholders: String = (1..=ids.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT st.sample_id, t.id, t.path, t.color
         FROM sample_tags st
         JOIN tags t ON t.id = st.tag_id
         WHERE st.sample_id IN ({placeholders})
         ORDER BY t.path COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;

    let mut by_id: HashMap<i64, Vec<TagChip>> = HashMap::new();
    for row in rows {
        let (sample_id, tag_id, path, stored_color) = row?;
        let color = stored_color
            .or_else(|| crate::tags::resolve_color(conn, tag_id).ok().flatten());
        by_id.entry(sample_id).or_default().push(TagChip { path, color });
    }
    for sample in samples.iter_mut() {
        if let Some(tags) = by_id.remove(&sample.id) {
            sample.tags = tags;
        }
    }
    Ok(())
}

pub fn list_samples(conn: &Connection, query: &Query) -> AppResult<Vec<SampleDto>> {
    let mut sql = String::from(SAMPLE_SELECT);
    sql.push_str(" WHERE 1=1");
    let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(prefix) = query.folder_prefix.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND (parent_path = ? OR parent_path LIKE ?)");
        binds.push(Box::new(prefix.to_string()));
        binds.push(Box::new(format!("{prefix}{}%", std::path::MAIN_SEPARATOR)));
    }

    if let Some(text) = query.text.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND filename LIKE ? COLLATE NOCASE");
        binds.push(Box::new(format!("%{text}%")));
    }

    let mut tag_filters: Vec<String> = query
        .tag_paths
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect();
    if tag_filters.is_empty() {
        if let Some(tag_path) = query.tag_path.as_deref().filter(|s| !s.is_empty()) {
            tag_filters.push(tag_path.to_string());
        }
    }
    for tag_path in &tag_filters {
        sql.push_str(
            " AND EXISTS (
                SELECT 1 FROM sample_tags st
                JOIN tags t ON t.id = st.tag_id
                WHERE st.sample_id = samples.id
                  AND (t.path = ? OR t.path LIKE ?)
            )",
        );
        binds.push(Box::new(tag_path.clone()));
        binds.push(Box::new(format!("{tag_path}/%")));
    }

    if query.bpm_min.is_some() || query.bpm_max.is_some() {
        let min = query.bpm_min.unwrap_or(0.0);
        let max = query.bpm_max.unwrap_or(f64::MAX);
        if query.half_double {
            sql.push_str(
                " AND bpm IS NOT NULL AND (
                    (bpm >= ? AND bpm <= ?)
                    OR (bpm >= ? AND bpm <= ?)
                    OR (bpm >= ? AND bpm <= ?)
                )",
            );
            binds.push(Box::new(min));
            binds.push(Box::new(max));
            binds.push(Box::new(min / 2.0));
            binds.push(Box::new(max / 2.0));
            binds.push(Box::new(min * 2.0));
            binds.push(Box::new(max * 2.0));
        } else {
            sql.push_str(" AND bpm IS NOT NULL AND bpm >= ? AND bpm <= ?");
            binds.push(Box::new(min));
            binds.push(Box::new(max));
        }
    }

    if let Some(key) = query.key.as_deref().filter(|s| !s.is_empty()) {
        let keys = key_match_set(key, query.relative_key);
        if !keys.is_empty() {
            let ph = vec!["?"; keys.len()].join(", ");
            sql.push_str(&format!(
                " AND key_name IS NOT NULL AND lower(replace(key_name, ' ', '')) IN ({ph})"
            ));
            for k in keys {
                binds.push(Box::new(k));
            }
        }
    }

    if let Some(sample_type) = query.sample_type.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND sample_type = ? COLLATE NOCASE");
        binds.push(Box::new(sample_type.to_string()));
    }

    if query.favorites_only {
        sql.push_str(" AND favorite = 1");
    }

    sql.push(' ');
    sql.push_str(order_clause(&query.sort_column, &query.sort_direction));

    if query.limit.is_some() {
        sql.push_str(" LIMIT ?");
        binds.push(Box::new(query.limit.unwrap()));
        if query.offset.is_some() {
            sql.push_str(" OFFSET ?");
            binds.push(Box::new(query.offset.unwrap_or(0)));
        }
    } else if let Some(offset) = query.offset {
        sql.push_str(" LIMIT -1 OFFSET ?");
        binds.push(Box::new(offset));
    }

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(params_refs.as_slice(), row_to_sample)?;
    let mut samples: Vec<SampleDto> = rows.filter_map(|r| r.ok()).collect();
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
        if relative {
            if let Some(rel) = relative_of(&equiv) {
                for e in enharmonic_forms(&rel) {
                    push(e);
                }
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
    // Collapse accidental spellings
    s.replace("♯", "#").replace("♭", "b")
}

fn parse_root_mode(key: &str) -> Option<(String, bool)> {
    let k = normalize_key_token(key);
    if k.is_empty() {
        return None;
    }
    let minor = k.ends_with('m');
    let root = if minor {
        k[..k.len() - 1].to_string()
    } else {
        k
    };
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

fn spellings_for(pc: u8) -> &'static [&'static str] {
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
    // Relative major of minor = +3 semitones; relative minor of major = -3.
    let rel_pc = if minor {
        (pc + 3) % 12
    } else {
        (pc + 9) % 12
    };
    let spelling = spellings_for(rel_pc).first()?;
    Some(if minor {
        (*spelling).to_string()
    } else {
        format!("{spelling}m")
    })
}

pub fn set_sample_favorite(conn: &Connection, id: i64, favorite: bool) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE samples SET favorite = ?1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?2",
        params![favorite as i64, id],
    )?;
    if n == 0 {
        return Err(crate::error::AppError::msg("sample not found"));
    }
    Ok(())
}

pub fn get_sample(conn: &Connection, id: i64) -> AppResult<Option<SampleDto>> {
    let mut stmt = conn.prepare(&format!("{SAMPLE_SELECT} WHERE id = ?1"))?;
    let mut sample = stmt
        .query_row(params![id], row_to_sample)
        .optional()?;
    if let Some(ref mut s) = sample {
        load_tags_for(conn, std::slice::from_mut(s))?;
    }
    Ok(sample)
}
