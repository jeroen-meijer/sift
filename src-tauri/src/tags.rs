use std::collections::HashMap;

use diesel::dsl::count_star;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde::Serialize;

use crate::db::models::{NewTag, SampleTag, Tag, TagReject};
use crate::db::schema::sample_tags::dsl as sample_tags_dsl;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::schema::tag_rejects::dsl as rejects_dsl;
use crate::db::schema::tags::dsl as tags_dsl;
use crate::error::{AppError, AppResult};
use crate::ids::{id_from_i64, id_to_i64};

#[derive(Debug, Clone, Serialize)]
pub struct TagNode {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub parent_id: Option<i64>,
    pub color: Option<String>,
    pub sample_count: i64,
    pub children: Vec<Self>,
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

fn build_tree(
    by_parent: &mut HashMap<Option<i64>, Vec<TagRow>>,
    parent: Option<i64>,
) -> Vec<TagNode> {
    let mut kids = by_parent.remove(&parent).unwrap_or_default();
    kids.sort_by_key(|row| row.path.to_lowercase());
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
                children: build_tree(by_parent, Some(id)),
            }
        })
        .collect()
}

pub fn list_tags(conn: &mut SqliteConnection) -> AppResult<Vec<TagNode>> {
    let tags: Vec<Tag> = tags_dsl::tags
        .select(Tag::as_select())
        .order(tags_dsl::path.asc())
        .load(conn)?;

    let counts: HashMap<i32, i64> = sample_tags_dsl::sample_tags
        .group_by(sample_tags_dsl::tag_id)
        .select((sample_tags_dsl::tag_id, count_star()))
        .load::<(i32, i64)>(conn)?
        .into_iter()
        .collect();

    let mut rows = Vec::with_capacity(tags.len());
    for tag in tags {
        rows.push(TagRow {
            id: id_to_i64(tag.id),
            path: tag.path,
            name: tag.name,
            parent_id: tag.parent_id.map(id_to_i64),
            color: tag.color,
            sample_count: counts.get(&tag.id).copied().unwrap_or(0),
        });
    }

    let mut by_parent: HashMap<Option<i64>, Vec<TagRow>> = HashMap::new();
    for row in rows {
        by_parent.entry(row.parent_id).or_default().push(row);
    }

    Ok(build_tree(&mut by_parent, None))
}

pub fn create_tag(
    conn: &mut SqliteConnection,
    path: &str,
    color: Option<&str>,
) -> AppResult<TagNode> {
    let path = path.trim().trim_matches('/');
    if path.is_empty() {
        return Err(AppError::msg("tag path is empty"));
    }
    if path.contains("//") || path.starts_with('/') || path.ends_with('/') {
        return Err(AppError::msg("invalid tag path"));
    }

    let name = path.rsplit('/').next().unwrap_or(path);
    let parent_id = match path.rsplit_once('/') {
        Some((parent_path, _)) => Some(
            tag_id_by_path(conn, parent_path)?
                .ok_or_else(|| AppError::msg(format!("parent tag not found: {parent_path}")))?,
        ),
        None => None,
    };

    let id: i32 = diesel::insert_into(tags_dsl::tags)
        .values(NewTag {
            path,
            name,
            parent_id,
            color,
        })
        .returning(tags_dsl::id)
        .get_result(conn)?;

    Ok(TagNode {
        id: id_to_i64(id),
        path: path.to_string(),
        name: name.to_string(),
        parent_id: parent_id.map(id_to_i64),
        color: color.map(ToString::to_string),
        sample_count: 0,
        children: Vec::new(),
    })
}

pub fn rename_tag(conn: &mut SqliteConnection, id: i64, name: &str) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') {
        return Err(AppError::msg("invalid tag name"));
    }
    let id = id_from_i64(id)?;
    let (old_path, parent_id): (String, Option<i32>) = tags_dsl::tags
        .find(id)
        .select((tags_dsl::path, tags_dsl::parent_id))
        .first(conn)
        .optional()?
        .ok_or_else(|| AppError::msg("tag not found"))?;

    let new_path = match parent_id {
        Some(pid) => {
            let parent_path: String = tags_dsl::tags
                .find(pid)
                .select(tags_dsl::path)
                .first(conn)?;
            format!("{parent_path}/{name}")
        }
        None => name.to_string(),
    };

    if new_path == old_path {
        diesel::update(tags_dsl::tags.find(id))
            .set(tags_dsl::name.eq(name))
            .execute(conn)?;
        return Ok(());
    }

    rewrite_paths(conn, &old_path, &new_path)?;
    diesel::update(tags_dsl::tags.find(id))
        .set((tags_dsl::name.eq(name), tags_dsl::path.eq(new_path)))
        .execute(conn)?;
    Ok(())
}

pub fn move_tag(conn: &mut SqliteConnection, id: i64, new_parent_id: Option<i64>) -> AppResult<()> {
    let id = id_from_i64(id)?;
    let (old_path, name, old_parent): (String, String, Option<i32>) = tags_dsl::tags
        .find(id)
        .select((tags_dsl::path, tags_dsl::name, tags_dsl::parent_id))
        .first(conn)
        .optional()?
        .ok_or_else(|| AppError::msg("tag not found"))?;

    let new_parent_i32 = new_parent_id.map(id_from_i64).transpose()?;
    if old_parent == new_parent_i32 {
        return Ok(());
    }

    if let Some(pid) = new_parent_i32 {
        if pid == id {
            return Err(AppError::msg("cannot move tag under itself"));
        }
        let parent_path: String = tags_dsl::tags
            .find(pid)
            .select(tags_dsl::path)
            .first(conn)
            .optional()?
            .ok_or_else(|| AppError::msg("parent tag not found"))?;
        if parent_path == old_path || parent_path.starts_with(&format!("{old_path}/")) {
            return Err(AppError::msg("cannot move tag under a descendant"));
        }
        let new_path = format!("{parent_path}/{name}");
        rewrite_paths(conn, &old_path, &new_path)?;
        diesel::update(tags_dsl::tags.find(id))
            .set((
                tags_dsl::parent_id.eq(Some(pid)),
                tags_dsl::path.eq(new_path),
            ))
            .execute(conn)?;
    } else {
        rewrite_paths(conn, &old_path, &name)?;
        diesel::update(tags_dsl::tags.find(id))
            .set((tags_dsl::parent_id.eq(None::<i32>), tags_dsl::path.eq(name)))
            .execute(conn)?;
    }
    Ok(())
}

pub fn set_tag_color(conn: &mut SqliteConnection, id: i64, color: Option<&str>) -> AppResult<()> {
    let n = diesel::update(tags_dsl::tags.find(id_from_i64(id)?))
        .set(tags_dsl::color.eq(color))
        .execute(conn)?;
    if n == 0 {
        return Err(AppError::msg("tag not found"));
    }
    Ok(())
}

pub fn delete_tag(conn: &mut SqliteConnection, id: i64, cascade: bool) -> AppResult<()> {
    let id = id_from_i64(id)?;
    let path: String = tags_dsl::tags
        .find(id)
        .select(tags_dsl::path)
        .first(conn)
        .optional()?
        .ok_or_else(|| AppError::msg("tag not found"))?;

    let child_count: i64 = tags_dsl::tags
        .filter(tags_dsl::path.like(format!("{path}/%")))
        .select(count_star())
        .first(conn)?;

    if child_count > 0 && !cascade {
        return Err(AppError::msg(
            "tag has children; pass cascade=true to delete them",
        ));
    }

    // FK ON DELETE CASCADE strips sample_tags / tag_rejects and child tags.
    let n = diesel::delete(tags_dsl::tags.find(id)).execute(conn)?;
    if n == 0 {
        return Err(AppError::msg("tag not found"));
    }
    Ok(())
}

pub fn set_sample_tags(
    conn: &mut SqliteConnection,
    sample_id: i64,
    tag_ids: &[i64],
) -> AppResult<()> {
    let sample_id = id_from_i64(sample_id)?;
    ensure_sample(conn, sample_id)?;
    diesel::delete(sample_tags_dsl::sample_tags.filter(sample_tags_dsl::sample_id.eq(sample_id)))
        .execute(conn)?;
    for tag_id in tag_ids {
        let tag_id = id_from_i64(*tag_id)?;
        ensure_tag(conn, tag_id)?;
        diesel::insert_into(sample_tags_dsl::sample_tags)
            .values(SampleTag {
                sample_id,
                tag_id,
                source: "user".into(),
            })
            .execute(conn)?;
        diesel::delete(
            rejects_dsl::tag_rejects
                .filter(rejects_dsl::sample_id.eq(sample_id))
                .filter(rejects_dsl::tag_id.eq(tag_id)),
        )
        .execute(conn)?;
    }
    Ok(())
}

pub fn add_sample_tag(conn: &mut SqliteConnection, sample_id: i64, tag_id: i64) -> AppResult<()> {
    let sample_id = id_from_i64(sample_id)?;
    let tag_id = id_from_i64(tag_id)?;
    ensure_sample(conn, sample_id)?;
    ensure_tag(conn, tag_id)?;
    diesel::insert_into(sample_tags_dsl::sample_tags)
        .values(SampleTag {
            sample_id,
            tag_id,
            source: "user".into(),
        })
        .on_conflict((sample_tags_dsl::sample_id, sample_tags_dsl::tag_id))
        .do_update()
        .set(sample_tags_dsl::source.eq("user"))
        .execute(conn)?;
    diesel::delete(
        rejects_dsl::tag_rejects
            .filter(rejects_dsl::sample_id.eq(sample_id))
            .filter(rejects_dsl::tag_id.eq(tag_id)),
    )
    .execute(conn)?;
    Ok(())
}

pub fn remove_sample_tag(
    conn: &mut SqliteConnection,
    sample_id: i64,
    tag_id: i64,
) -> AppResult<()> {
    let sample_id = id_from_i64(sample_id)?;
    let tag_id = id_from_i64(tag_id)?;
    let source: Option<String> = sample_tags_dsl::sample_tags
        .filter(sample_tags_dsl::sample_id.eq(sample_id))
        .filter(sample_tags_dsl::tag_id.eq(tag_id))
        .select(sample_tags_dsl::source)
        .first(conn)
        .optional()?;

    let Some(source) = source else {
        return Ok(());
    };

    diesel::delete(
        sample_tags_dsl::sample_tags
            .filter(sample_tags_dsl::sample_id.eq(sample_id))
            .filter(sample_tags_dsl::tag_id.eq(tag_id)),
    )
    .execute(conn)?;

    if source == "auto" {
        diesel::insert_into(rejects_dsl::tag_rejects)
            .values(TagReject { sample_id, tag_id })
            .on_conflict_do_nothing()
            .execute(conn)?;
    }
    Ok(())
}

/// Resolve stored color walking ancestors (nearest non-null wins).
pub fn resolve_color(conn: &mut SqliteConnection, tag_id: i64) -> AppResult<Option<String>> {
    let mut current = Some(id_from_i64(tag_id)?);
    while let Some(id) = current {
        let (color, parent_id): (Option<String>, Option<i32>) = tags_dsl::tags
            .find(id)
            .select((tags_dsl::color, tags_dsl::parent_id))
            .first(conn)?;
        if color.is_some() {
            return Ok(color);
        }
        current = parent_id;
    }
    Ok(None)
}

fn rewrite_paths(conn: &mut SqliteConnection, old_path: &str, new_path: &str) -> AppResult<()> {
    if tag_id_by_path(conn, new_path)?.is_some() {
        return Err(AppError::msg(format!(
            "tag path already exists: {new_path}"
        )));
    }
    // Descendants first (longer paths) so unique path constraint stays happy.
    let mut kids: Vec<(i32, String)> = tags_dsl::tags
        .filter(tags_dsl::path.like(format!("{old_path}/%")))
        .select((tags_dsl::id, tags_dsl::path))
        .load(conn)?;
    kids.sort_by_key(|(_, p)| std::cmp::Reverse(p.len()));

    for (kid_id, kid_path) in kids {
        let suffix = kid_path.strip_prefix(old_path).unwrap_or(kid_path.as_str());
        let updated = format!("{new_path}{suffix}");
        if tag_id_by_path(conn, &updated)?.is_some() {
            return Err(AppError::msg(format!("tag path already exists: {updated}")));
        }
        diesel::update(tags_dsl::tags.find(kid_id))
            .set(tags_dsl::path.eq(updated))
            .execute(conn)?;
    }
    Ok(())
}

fn tag_id_by_path(conn: &mut SqliteConnection, path: &str) -> AppResult<Option<i32>> {
    Ok(tags_dsl::tags
        .filter(tags_dsl::path.eq(path))
        .select(tags_dsl::id)
        .first(conn)
        .optional()?)
}

fn ensure_tag(conn: &mut SqliteConnection, id: i32) -> AppResult<()> {
    let exists: Option<i32> = tags_dsl::tags
        .find(id)
        .select(tags_dsl::id)
        .first(conn)
        .optional()?;
    if exists.is_none() {
        return Err(AppError::msg("tag not found"));
    }
    Ok(())
}

fn ensure_sample(conn: &mut SqliteConnection, id: i32) -> AppResult<()> {
    let exists: Option<i32> = samples_dsl::samples
        .find(id)
        .select(samples_dsl::id)
        .first(conn)
        .optional()?;
    if exists.is_none() {
        return Err(AppError::msg("sample not found"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{add_sample_tag, create_tag, list_tags};
    use crate::db::schema::roots::dsl as roots_dsl;
    use crate::db::schema::samples::dsl as samples_dsl;
    use diesel::prelude::*;

    #[test]
    fn list_tags_counts_via_group_by() {
        let mut conn = crate::db::test_conn();
        diesel::insert_into(roots_dsl::roots)
            .values((roots_dsl::path.eq("/lib"), roots_dsl::label.eq("lib")))
            .execute(&mut conn)
            .unwrap();
        let root_id: i32 = roots_dsl::roots
            .select(roots_dsl::id)
            .first(&mut conn)
            .unwrap();
        diesel::insert_into(samples_dsl::samples)
            .values((
                samples_dsl::root_id.eq(root_id),
                samples_dsl::path.eq("/lib/a.wav"),
                samples_dsl::filename.eq("a.wav"),
                samples_dsl::parent_path.eq("/lib"),
                samples_dsl::extension.eq("wav"),
            ))
            .execute(&mut conn)
            .unwrap();
        diesel::insert_into(samples_dsl::samples)
            .values((
                samples_dsl::root_id.eq(root_id),
                samples_dsl::path.eq("/lib/b.wav"),
                samples_dsl::filename.eq("b.wav"),
                samples_dsl::parent_path.eq("/lib"),
                samples_dsl::extension.eq("wav"),
            ))
            .execute(&mut conn)
            .unwrap();
        let ids: Vec<i32> = samples_dsl::samples
            .select(samples_dsl::id)
            .load(&mut conn)
            .unwrap();

        let drums = create_tag(&mut conn, "drums", None).unwrap();
        let kicks = create_tag(&mut conn, "drums/kicks", None).unwrap();
        let unused = create_tag(&mut conn, "unused", None).unwrap();
        add_sample_tag(&mut conn, i64::from(ids[0]), kicks.id).unwrap();
        add_sample_tag(&mut conn, i64::from(ids[1]), kicks.id).unwrap();

        let tree = list_tags(&mut conn).unwrap();
        let drums_node = tree.iter().find(|n| n.path == "drums").expect("drums");
        assert_eq!(drums_node.id, drums.id);
        let kicks_node = drums_node
            .children
            .iter()
            .find(|n| n.path == "drums/kicks")
            .expect("kicks");
        assert_eq!(kicks_node.sample_count, 2);
        let unused_node = tree.iter().find(|n| n.path == "unused").expect("unused");
        assert_eq!(unused_node.sample_count, 0);
        assert_eq!(unused.id, unused_node.id);
    }
}
