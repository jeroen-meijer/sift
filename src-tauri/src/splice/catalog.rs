//! Open Splice `sounds.db` read-only and look up samples by path or SHA-256.

#![allow(
    clippy::significant_drop_tightening,
    reason = "catalog MutexGuard spans the DB query; early drop fights clarity"
)]

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use diesel::prelude::*;
use diesel::sql_types::{Integer, Nullable, Text};
use diesel::sqlite::SqliteConnection;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::map::{SPLICE_CONFIDENCE, map_key, map_sample_type};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct CatalogStatus {
    pub path: Option<String>,
    pub row_count: Option<i64>,
    pub ok: bool,
    pub error: Option<String>,
    pub splice_folder: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SpliceHit {
    pub bpm: Option<f64>,
    pub key_name: Option<String>,
    pub sample_type: Option<String>,
    pub confidence: f64,
}

struct OpenedCatalog {
    path: PathBuf,
    /// Temp dir keeping a snapshot when the live DB was locked.
    _snapshot: Option<tempfile::TempDir>,
    conn: SqliteConnection,
}

static CATALOG: Mutex<Option<OpenedCatalog>> = Mutex::new(None);

/// Re-detect and open the catalog; updates the process-wide handle.
pub fn refresh_catalog_status() -> CatalogStatus {
    let detected = super::detect::detect_sounds_db();
    let Some(detected) = detected else {
        let mut guard = CATALOG
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = None;
        return CatalogStatus {
            path: None,
            row_count: None,
            ok: false,
            error: Some("Splice sounds.db not found".to_string()),
            splice_folder: None,
        };
    };
    match open_catalog(&detected.path) {
        Ok(mut opened) => {
            let row_count = count_rows(&mut opened.conn).ok();
            let status = CatalogStatus {
                path: Some(opened.path.to_string_lossy().to_string()),
                row_count,
                ok: true,
                error: None,
                splice_folder: detected.splice_folder.clone(),
            };
            let mut guard = CATALOG
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *guard = Some(opened);
            status
        }
        Err(e) => {
            let mut guard = CATALOG
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *guard = None;
            CatalogStatus {
                path: Some(detected.path.to_string_lossy().to_string()),
                row_count: None,
                ok: false,
                error: Some(e.to_string()),
                splice_folder: detected.splice_folder,
            }
        }
    }
}

/// Look up a local sample path. Path match first; SHA-256 only on miss.
pub fn lookup(sample_path: &Path) -> AppResult<Option<SpliceHit>> {
    {
        let guard = CATALOG
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.is_none() {
            drop(guard);
            let _ = refresh_catalog_status();
        }
    }

    let mut guard = CATALOG
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(opened) = guard.as_mut() else {
        return Ok(None);
    };

    let path_str = sample_path.to_string_lossy();
    if let Some(hit) = query_by_path(&mut opened.conn, &path_str)? {
        return Ok(Some(hit));
    }

    // Only hash when bytes are readable (local, not a cloud stub).
    if !sample_path.is_file() {
        return Ok(None);
    }
    let Ok(hash) = file_sha256_hex(sample_path) else {
        return Ok(None);
    };
    query_by_hash(&mut opened.conn, &hash)
}

fn open_catalog(path: &Path) -> AppResult<OpenedCatalog> {
    if let Ok(conn) = try_open_ro(path) {
        return Ok(OpenedCatalog {
            path: path.to_path_buf(),
            _snapshot: None,
            conn,
        });
    }
    let snapshot = snapshot_db(path)?;
    let snap_path = snapshot.path().join("sounds.db");
    let conn = try_open_ro(&snap_path)?;
    Ok(OpenedCatalog {
        path: path.to_path_buf(),
        _snapshot: Some(snapshot),
        conn,
    })
}

fn try_open_ro(path: &Path) -> AppResult<SqliteConnection> {
    // URI so we can pass mode=ro without mutating the live WAL.
    let uri = format!("file:{}?mode=ro", path.display());
    SqliteConnection::establish(&uri).map_err(|e| AppError::msg(e.to_string()))
}

fn snapshot_db(path: &Path) -> AppResult<tempfile::TempDir> {
    let dir = tempfile::tempdir().map_err(|e| AppError::msg(e.to_string()))?;
    let dest = dir.path().join("sounds.db");
    fs::copy(path, &dest).map_err(|e| AppError::msg(e.to_string()))?;
    for suffix in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{suffix}", path.display()));
        if side.is_file() {
            let name = format!("sounds.db{suffix}");
            let _ = fs::copy(&side, dir.path().join(name));
        }
    }
    Ok(dir)
}

fn count_rows(conn: &mut SqliteConnection) -> AppResult<i64> {
    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = Integer)]
        n: i32,
    }
    let row: CountRow = diesel::sql_query("SELECT COUNT(*) AS n FROM samples").get_result(conn)?;
    Ok(i64::from(row.n))
}

#[derive(QueryableByName, Debug)]
struct RawHit {
    #[diesel(sql_type = Nullable<Integer>)]
    bpm: Option<i32>,
    #[diesel(sql_type = Nullable<Text>)]
    audio_key: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    chord_type: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    sample_type: Option<String>,
}

fn query_by_path(conn: &mut SqliteConnection, path: &str) -> AppResult<Option<SpliceHit>> {
    let rows: Vec<RawHit> = diesel::sql_query(
        "SELECT bpm, audio_key, chord_type, sample_type FROM samples WHERE local_path = ?1 LIMIT 1",
    )
    .bind::<Text, _>(path)
    .load(conn)?;
    Ok(rows.into_iter().next().map(into_hit))
}

fn query_by_hash(conn: &mut SqliteConnection, hash: &str) -> AppResult<Option<SpliceHit>> {
    let rows: Vec<RawHit> = diesel::sql_query(
        "SELECT bpm, audio_key, chord_type, sample_type FROM samples WHERE file_hash = ?1 LIMIT 1",
    )
    .bind::<Text, _>(hash)
    .load(conn)?;
    Ok(rows.into_iter().next().map(into_hit))
}

fn into_hit(row: RawHit) -> SpliceHit {
    SpliceHit {
        // Catalog 0 means no tempo (oneshots / drums), not 0 BPM.
        bpm: row.bpm.filter(|&b| b > 0).map(f64::from),
        key_name: map_key(row.audio_key.as_deref(), row.chord_type.as_deref()),
        sample_type: map_sample_type(row.sample_type.as_deref()),
        confidence: SPLICE_CONFIDENCE,
    }
}

fn file_sha256_hex(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path).map_err(|e| AppError::msg(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| AppError::msg(e.to_string()))?;
        if n == 0 {
            break;
        }
        let Some(chunk) = buf.get(..n) else {
            break;
        };
        hasher.update(chunk);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;

    fn fixture_db() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sounds.db");
        let mut conn = SqliteConnection::establish(path.to_str().expect("utf8")).expect("open");
        conn.batch_execute(
            "CREATE TABLE samples (
                id INTEGER PRIMARY KEY,
                local_path TEXT,
                file_hash TEXT NOT NULL UNIQUE,
                audio_key TEXT,
                bpm INTEGER,
                chord_type TEXT,
                sample_type TEXT
            );
            INSERT INTO samples (local_path, file_hash, audio_key, bpm, chord_type, sample_type)
            VALUES (
                '/tmp/fixture.wav',
                'abc123',
                'd',
                80,
                'minor',
                'loop'
            );",
        )
        .expect("schema");
        drop(conn);
        (dir, path)
    }

    #[test]
    fn path_and_hash_lookup() {
        let (dir, db_path) = fixture_db();
        let opened = open_catalog(&db_path).expect("open");
        {
            let mut guard = CATALOG
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *guard = Some(opened);
        }

        let hit = lookup(Path::new("/tmp/fixture.wav"))
            .expect("lookup")
            .expect("hit");
        assert_eq!(hit.bpm, Some(80.0));
        assert_eq!(hit.key_name.as_deref(), Some("Dm"));
        assert_eq!(hit.sample_type.as_deref(), Some("loop"));

        let sample = dir.path().join("copy.wav");
        fs::write(&sample, b"hello").expect("write");
        let hash = file_sha256_hex(&sample).expect("hash");
        let mut conn =
            SqliteConnection::establish(db_path.to_str().expect("utf8")).expect("reopen");
        diesel::sql_query("UPDATE samples SET local_path = NULL, file_hash = ?1")
            .bind::<Text, _>(&hash)
            .execute(&mut conn)
            .expect("update");
        drop(conn);
        {
            let opened = open_catalog(&db_path).expect("reopen catalog");
            let mut guard = CATALOG
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *guard = Some(opened);
        }
        let hit = lookup(&sample).expect("lookup").expect("hash hit");
        assert_eq!(hit.key_name.as_deref(), Some("Dm"));

        let mut guard = CATALOG
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = None;
    }
}
