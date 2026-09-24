//! Non-decode catalog enrich: Splice match → write creative fields by precedence.

use std::path::Path;
use std::time::Instant;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use tauri::{AppHandle, Manager};

use crate::db::Db;
use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::settings;
use crate::db::utc_now;
use crate::error::AppResult;
use crate::ids::{id_from_i64, id_to_i64};
use crate::meta_source::{MetaSource, should_write};
use crate::splice::{self, SpliceHit};
use crate::state::AppState;

/// Whether Settings has Splice metadata enabled (default true when unset).
pub fn splice_enabled(conn: &mut SqliteConnection) -> AppResult<bool> {
    Ok(settings::get(conn, "splice_enabled")?
        .and_then(|v| v.as_bool())
        .unwrap_or(true))
}

#[derive(Debug, Clone)]
struct EnrichRow {
    path: String,
    bpm: Option<f64>,
    key_name: Option<String>,
    sample_type: Option<String>,
    catalog_source: Option<String>,
    bpm_source: Option<String>,
    key_source: Option<String>,
    sample_type_source: Option<String>,
}

/// Apply Splice catalog to one sample. Returns true when any column changed.
/// When `clear_lost_match` is set (Refresh metadata) and the row was splice but
/// no longer matches, clears `catalog_source` only.
pub fn enrich_sample(
    conn: &mut SqliteConnection,
    sample_id: i64,
    clear_lost_match: bool,
) -> AppResult<bool> {
    if !splice_enabled(conn)? {
        return Ok(false);
    }
    let id = id_from_i64(sample_id)?;
    let row: Option<EnrichRow> = samples_dsl::samples
        .find(id)
        .select((
            samples_dsl::path,
            samples_dsl::bpm,
            samples_dsl::key_name,
            samples_dsl::sample_type,
            samples_dsl::catalog_source,
            samples_dsl::bpm_source,
            samples_dsl::key_source,
            samples_dsl::sample_type_source,
        ))
        .first::<(
            String,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )>(conn)
        .optional()?
        .map(
            |(
                path,
                bpm,
                key_name,
                sample_type,
                catalog_source,
                bpm_source,
                key_source,
                sample_type_source,
            )| EnrichRow {
                path,
                bpm,
                key_name,
                sample_type,
                catalog_source,
                bpm_source,
                key_source,
                sample_type_source,
            },
        );
    let Some(row) = row else {
        return Ok(false);
    };

    let hit = splice::lookup(Path::new(&row.path))?;
    match hit {
        Some(hit) => apply_hit(conn, id, &row, &hit),
        None if clear_lost_match && row.catalog_source.as_deref() == Some("splice") => {
            diesel::update(samples_dsl::samples.find(id))
                .set((
                    samples_dsl::catalog_source.eq(Option::<String>::None),
                    samples_dsl::updated_at.eq(utc_now()),
                ))
                .execute(conn)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

fn apply_hit(
    conn: &mut SqliteConnection,
    id: i32,
    row: &EnrichRow,
    hit: &SpliceHit,
) -> AppResult<bool> {
    let mut changed = false;
    let now = utc_now();

    if row.catalog_source.as_deref() != Some("splice") {
        diesel::update(samples_dsl::samples.find(id))
            .set(samples_dsl::catalog_source.eq(Some("splice")))
            .execute(conn)?;
        changed = true;
    }

    if let Some(bpm) = hit.bpm.filter(|b| *b > 0.0)
        && should_write(
            row.bpm.is_none_or(|b| b <= 0.0),
            row.bpm_source.as_deref(),
            MetaSource::Splice,
            false,
        )
    {
        diesel::update(samples_dsl::samples.find(id))
            .set((
                samples_dsl::bpm.eq(Some(bpm)),
                samples_dsl::bpm_confidence.eq(Some(hit.confidence)),
                samples_dsl::bpm_source.eq(Some(MetaSource::Splice.as_str())),
            ))
            .execute(conn)?;
        changed = true;
    }

    if let Some(ref key) = hit.key_name
        && should_write(
            row.key_name.is_none(),
            row.key_source.as_deref(),
            MetaSource::Splice,
            false,
        )
    {
        diesel::update(samples_dsl::samples.find(id))
            .set((
                samples_dsl::key_name.eq(Some(key.as_str())),
                samples_dsl::key_confidence.eq(Some(hit.confidence)),
                samples_dsl::key_source.eq(Some(MetaSource::Splice.as_str())),
            ))
            .execute(conn)?;
        changed = true;
    }

    if let Some(ref st) = hit.sample_type
        && should_write(
            row.sample_type.is_none(),
            row.sample_type_source.as_deref(),
            MetaSource::Splice,
            false,
        )
    {
        diesel::update(samples_dsl::samples.find(id))
            .set((
                samples_dsl::sample_type.eq(Some(st.as_str())),
                samples_dsl::sample_type_source.eq(Some(MetaSource::Splice.as_str())),
            ))
            .execute(conn)?;
        changed = true;
    }

    if changed {
        diesel::update(samples_dsl::samples.find(id))
            .set(samples_dsl::updated_at.eq(now))
            .execute(conn)?;
    }
    Ok(changed)
}

/// Refresh metadata for every non-missing sample (Splice catalog only).
/// Drives the shared work bar while matching.
pub fn refresh_metadata_all(app: &AppHandle, db: &Db) -> AppResult<u64> {
    if !db.with_conn(splice_enabled)? {
        return Ok(0);
    }
    let _ = splice::refresh_catalog_status();
    let ids: Vec<i64> = db.with_conn(|conn| {
        let rows: Vec<i32> = samples_dsl::samples
            .filter(samples_dsl::missing.eq(0))
            .select(samples_dsl::id)
            .load(conn)?;
        Ok(rows.into_iter().map(id_to_i64).collect())
    })?;
    let total = u64::try_from(ids.len()).unwrap_or(u64::MAX);
    super::work::start(app, total);

    let mut changed = 0u64;
    let mut changed_ids: Vec<i64> = Vec::new();
    let mut last_emit = Instant::now();
    for (i, sample_id) in ids.iter().copied().enumerate() {
        let did = db.with_conn(|conn| enrich_sample(conn, sample_id, true))?;
        if did {
            changed = changed.saturating_add(1);
            changed_ids.push(sample_id);
        }
        let done = u64::try_from(i.saturating_add(1)).unwrap_or(u64::MAX);
        let should_emit = done == total
            || done.is_multiple_of(25)
            || last_emit.elapsed() >= std::time::Duration::from_millis(250);
        if should_emit {
            last_emit = Instant::now();
            super::work::tick(app, done, total, sample_id);
        }
    }
    super::work::finish(app, total);

    if !changed_ids.is_empty() {
        app.state::<AppState>()
            .changes
            .push(app, "refresh-metadata", false, &changed_ids);
    }
    Ok(changed)
}
