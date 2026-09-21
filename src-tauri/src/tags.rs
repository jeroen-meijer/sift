use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct TagNode {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub parent_id: Option<i64>,
    pub color: Option<String>,
    pub sample_count: i64,
    pub children: Vec<TagNode>,
}

#[derive(Debug, Clone)]
struct TagRow {
    id: i64,
    path: String,
    name: String,
    parent_id: Option<i64>,
    color: Option<String>,
    sample_count: i64,
}

pub fn list_tags(conn: &Connection) -> AppResult<Vec<TagNode>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.name, t.parent_id, t.color,
                (SELECT COUNT(*) FROM sample_tags st WHERE st.tag_id = t.id) AS sample_count
         FROM tags t
         ORDER BY t.path COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TagRow {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            parent_id: row.get(3)?,
            color: row.get(4)?,
            sample_count: row.get(5)?,
        })
    })?;

    let mut by_parent: HashMap<Option<i64>, Vec<TagRow>> = HashMap::new();
    for row in rows {
        let row = row?;
        by_parent.entry(row.parent_id).or_default().push(row);
    }

    fn build(by_parent: &mut HashMap<Option<i64>, Vec<TagRow>>, parent: Option<i64>) -> Vec<TagNode> {
        let mut kids = by_parent.remove(&parent).unwrap_or_default();
        kids.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        kids.into_iter()
            .map(|row| {
                let id = row.id;
                TagNode {
                    id,
                    path: row.path,
                    name: row.name,
                    parent_id: row.parent_id,
                    color: row.color,
                    sample_count: row.sample_count,
                    children: build(by_parent, Some(id)),
                }
            })
            .collect()
    }

    Ok(build(&mut by_parent, None))
}

pub fn create_tag(conn: &Connection, path: &str, color: Option<&str>) -> AppResult<TagNode> {
    let path = path.trim().trim_matches('/');
    if path.is_empty() {
        return Err(AppError::msg("tag path is empty"));
    }
    if path.contains("//") || path.starts_with('/') || path.ends_with('/') {
        return Err(AppError::msg("invalid tag path"));
    }

    let name = path.rsplit('/').next().unwrap_or(path);
    let parent_id = if let Some((parent_path, _)) = path.rsplit_once('/') {
        Some(tag_id_by_path(conn, parent_path)?.ok_or_else(|| {
            AppError::msg(format!("parent tag not found: {parent_path}"))
        })?)
    } else {
        None
    };

    conn.execute(
        "INSERT INTO tags(path, name, parent_id, color) VALUES (?1, ?2, ?3, ?4)",
        params![path, name, parent_id, color],
    )?;
    let id = conn.last_insert_rowid();
    Ok(TagNode {
        id,
        path: path.to_string(),
        name: name.to_string(),
        parent_id,
        color: color.map(|c| c.to_string()),
        sample_count: 0,
        children: Vec::new(),
    })
}

pub fn rename_tag(conn: &Connection, id: i64, name: &str) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') {
        return Err(AppError::msg("invalid tag name"));
    }
    let (old_path, parent_id): (String, Option<i64>) = conn
        .query_row(
            "SELECT path, parent_id FROM tags WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::msg("tag not found"))?;

    let new_path = match parent_id {
        Some(pid) => {
            let parent_path: String = conn.query_row(
                "SELECT path FROM tags WHERE id = ?1",
                params![pid],
                |r| r.get(0),
            )?;
            format!("{parent_path}/{name}")
        }
        None => name.to_string(),
    };

    if new_path == old_path {
        conn.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![name, id])?;
        return Ok(());
    }

    rewrite_paths(conn, &old_path, &new_path)?;
    conn.execute(
        "UPDATE tags SET name = ?1, path = ?2 WHERE id = ?3",
        params![name, new_path, id],
    )?;
    Ok(())
}

pub fn move_tag(conn: &Connection, id: i64, new_parent_id: Option<i64>) -> AppResult<()> {
    let (old_path, name, old_parent): (String, String, Option<i64>) = conn
        .query_row(
            "SELECT path, name, parent_id FROM tags WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::msg("tag not found"))?;

    if old_parent == new_parent_id {
        return Ok(());
    }

    if let Some(pid) = new_parent_id {
        if pid == id {
            return Err(AppError::msg("cannot move tag under itself"));
        }
        let parent_path: String = conn
            .query_row(
                "SELECT path FROM tags WHERE id = ?1",
                params![pid],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::msg("parent tag not found"))?;
        if parent_path == old_path || parent_path.starts_with(&format!("{old_path}/")) {
            return Err(AppError::msg("cannot move tag under a descendant"));
        }
        let new_path = format!("{parent_path}/{name}");
        rewrite_paths(conn, &old_path, &new_path)?;
        conn.execute(
            "UPDATE tags SET parent_id = ?1, path = ?2 WHERE id = ?3",
            params![pid, new_path, id],
        )?;
    } else {
        let new_path = name.clone();
        rewrite_paths(conn, &old_path, &new_path)?;
        conn.execute(
            "UPDATE tags SET parent_id = NULL, path = ?1 WHERE id = ?2",
            params![new_path, id],
        )?;
    }
    Ok(())
}

pub fn set_tag_color(conn: &Connection, id: i64, color: Option<&str>) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE tags SET color = ?1 WHERE id = ?2",
        params![color, id],
    )?;
    if n == 0 {
        return Err(AppError::msg("tag not found"));
    }
    Ok(())
}

pub fn delete_tag(conn: &Connection, id: i64, cascade: bool) -> AppResult<()> {
    let path: String = conn
        .query_row("SELECT path FROM tags WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .optional()?
        .ok_or_else(|| AppError::msg("tag not found"))?;

    let child_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE path LIKE ?1",
        params![format!("{path}/%")],
        |r| r.get(0),
    )?;

    if child_count > 0 && !cascade {
        return Err(AppError::msg(
            "tag has children; pass cascade=true to delete them",
        ));
    }

    // FK ON DELETE CASCADE strips sample_tags / tag_rejects and child tags.
    let n = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    if n == 0 {
        return Err(AppError::msg("tag not found"));
    }
    Ok(())
}

pub fn set_sample_tags(conn: &Connection, sample_id: i64, tag_ids: &[i64]) -> AppResult<()> {
    ensure_sample(conn, sample_id)?;
    conn.execute(
        "DELETE FROM sample_tags WHERE sample_id = ?1",
        params![sample_id],
    )?;
    for tag_id in tag_ids {
        ensure_tag(conn, *tag_id)?;
        conn.execute(
            "INSERT INTO sample_tags(sample_id, tag_id, source) VALUES (?1, ?2, 'user')",
            params![sample_id, tag_id],
        )?;
        conn.execute(
            "DELETE FROM tag_rejects WHERE sample_id = ?1 AND tag_id = ?2",
            params![sample_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn add_sample_tag(conn: &Connection, sample_id: i64, tag_id: i64) -> AppResult<()> {
    ensure_sample(conn, sample_id)?;
    ensure_tag(conn, tag_id)?;
    conn.execute(
        "INSERT INTO sample_tags(sample_id, tag_id, source) VALUES (?1, ?2, 'user')
         ON CONFLICT(sample_id, tag_id) DO UPDATE SET source = 'user'",
        params![sample_id, tag_id],
    )?;
    conn.execute(
        "DELETE FROM tag_rejects WHERE sample_id = ?1 AND tag_id = ?2",
        params![sample_id, tag_id],
    )?;
    Ok(())
}

pub fn remove_sample_tag(conn: &Connection, sample_id: i64, tag_id: i64) -> AppResult<()> {
    let source: Option<String> = conn
        .query_row(
            "SELECT source FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2",
            params![sample_id, tag_id],
            |r| r.get(0),
        )
        .optional()?;

    let Some(source) = source else {
        return Ok(());
    };

    conn.execute(
        "DELETE FROM sample_tags WHERE sample_id = ?1 AND tag_id = ?2",
        params![sample_id, tag_id],
    )?;

    if source == "auto" {
        conn.execute(
            "INSERT OR IGNORE INTO tag_rejects(sample_id, tag_id) VALUES (?1, ?2)",
            params![sample_id, tag_id],
        )?;
    }
    Ok(())
}

/// Resolve stored color walking ancestors (nearest non-null wins).
pub fn resolve_color(conn: &Connection, tag_id: i64) -> AppResult<Option<String>> {
    let mut current = Some(tag_id);
    while let Some(id) = current {
        let (color, parent_id): (Option<String>, Option<i64>) = conn.query_row(
            "SELECT color, parent_id FROM tags WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if color.is_some() {
            return Ok(color);
        }
        current = parent_id;
    }
    Ok(None)
}

fn rewrite_paths(conn: &Connection, old_path: &str, new_path: &str) -> AppResult<()> {
    if tag_id_by_path(conn, new_path)?.is_some() {
        return Err(AppError::msg(format!("tag path already exists: {new_path}")));
    }
    // Descendants first (longer paths) so unique path constraint stays happy.
    let mut stmt = conn.prepare(
        "SELECT id, path FROM tags WHERE path LIKE ?1 ORDER BY length(path) DESC",
    )?;
    let kids: Vec<(i64, String)> = stmt
        .query_map(params![format!("{old_path}/%")], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for (kid_id, kid_path) in kids {
        let suffix = &kid_path[old_path.len()..];
        let updated = format!("{new_path}{suffix}");
        if tag_id_by_path(conn, &updated)?.is_some() {
            return Err(AppError::msg(format!("tag path already exists: {updated}")));
        }
        conn.execute(
            "UPDATE tags SET path = ?1 WHERE id = ?2",
            params![updated, kid_id],
        )?;
    }
    Ok(())
}

fn tag_id_by_path(conn: &Connection, path: &str) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM tags WHERE path = ?1",
            params![path],
            |r| r.get(0),
        )
        .optional()?)
}

fn ensure_tag(conn: &Connection, id: i64) -> AppResult<()> {
    let exists: bool = conn
        .query_row("SELECT 1 FROM tags WHERE id = ?1", params![id], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !exists {
        return Err(AppError::msg("tag not found"));
    }
    Ok(())
}

fn ensure_sample(conn: &Connection, id: i64) -> AppResult<()> {
    let exists: bool = conn
        .query_row("SELECT 1 FROM samples WHERE id = ?1", params![id], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !exists {
        return Err(AppError::msg("sample not found"));
    }
    Ok(())
}
