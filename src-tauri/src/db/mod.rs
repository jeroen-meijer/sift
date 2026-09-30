pub mod models;
pub mod schema;
pub mod settings;
pub mod taxonomy;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

use crate::error::{AppError, AppResult};
use crate::paths::AppPaths;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// UTC timestamp matching SQLite `strftime('%Y-%m-%dT%H:%M:%fZ','now')` style.
pub fn utc_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Escape `LIKE` wildcards so `%` and `_` in user text match literally (with `ESCAPE '\'`).
#[allow(
    clippy::redundant_pub_crate,
    reason = "crate-private by design; samples and tags share it"
)]
pub(crate) fn escape_like(token: &str) -> String {
    let mut out = String::with_capacity(token.len());
    for c in token.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Set when open recovered from a migrate failure by backing up the broken DB.
#[derive(Debug, Clone)]
pub struct LibraryRecovery {
    pub backup_path: PathBuf,
    pub migrate_error: String,
}

pub struct Db {
    conn: Mutex<SqliteConnection>,
}

impl Db {
    /// Open (and migrate) the library DB.
    ///
    /// On migrate/schema failure: rename the broken files to a `.bak-{UTC}`
    /// sibling, open a fresh empty DB, and return recovery info for the UI.
    /// On lock/busy: fail with an "already open" error (no wipe, no backup).
    pub fn open(paths: &AppPaths) -> AppResult<(Self, Option<LibraryRecovery>)> {
        match Self::open_inner(paths) {
            Ok(db) => Ok((db, None)),
            Err(e) if is_lock_or_busy(&e) => Err(AppError::msg(
                "Sift is already open in another window. Quit that window and try again.",
            )),
            Err(e) if e.to_string().contains("migrate:") => {
                let migrate_error = e.to_string();
                let backup_path = backup_broken_db(&paths.db_path)?;
                let db = Self::open_inner(paths)?;
                Ok((
                    db,
                    Some(LibraryRecovery {
                        backup_path,
                        migrate_error,
                    }),
                ))
            }
            Err(e) => Err(e),
        }
    }

    fn open_inner(paths: &AppPaths) -> AppResult<Self> {
        // Diesel SQLite expects a filesystem path (not a URL).
        let mut conn = SqliteConnection::establish(paths.db_path.to_str().unwrap_or_default())
            .map_err(|e| AppError::msg(format!("open db: {e}")))?;

        conn.batch_execute(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            ",
        )
        .map_err(|e| AppError::msg(format!("pragma: {e}")))?;

        conn.run_pending_migrations(MIGRATIONS)
            .map_err(|e| AppError::msg(format!("migrate: {e}")))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        {
            let mut conn = db
                .conn
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            settings::ensure_defaults(&mut conn, paths)?;
            taxonomy::seed_if_empty(&mut conn)?;
        }
        Ok(db)
    }

    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&mut SqliteConnection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut conn)
    }
}

/// True when SQLite refused the open because another process holds the DB.
fn is_lock_or_busy(err: &AppError) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    msg.contains("database is locked")
        || msg.contains("database is busy")
        || msg.contains("sqlite_busy")
        || msg.contains("sqlite_locked")
}

/// Rename `db_path` (+ wal/shm) to `db_path.bak-{UTC}` siblings. Returns the backup DB path.
fn backup_broken_db(db_path: &Path) -> AppResult<PathBuf> {
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H%M%SZ");
    let backup = PathBuf::from(format!("{}.bak-{stamp}", db_path.display()));
    if db_path.exists() {
        std::fs::rename(db_path, &backup)
            .map_err(|e| AppError::msg(format!("backup library db: {e}")))?;
    }
    let wal = PathBuf::from(format!("{}-wal", db_path.display()));
    let shm = PathBuf::from(format!("{}-shm", db_path.display()));
    let backup_wal = PathBuf::from(format!("{}-wal", backup.display()));
    let backup_shm = PathBuf::from(format!("{}-shm", backup.display()));
    if wal.exists() {
        let _ = std::fs::rename(&wal, &backup_wal);
    }
    if shm.exists() {
        let _ = std::fs::rename(&shm, &backup_shm);
    }
    Ok(backup)
}

/// In-memory database with all migrations, for unit tests.
#[cfg(test)]
pub fn test_conn() -> SqliteConnection {
    let mut conn = SqliteConnection::establish(":memory:").expect("in-memory db");
    conn.run_pending_migrations(MIGRATIONS).expect("migrations");
    conn
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use std::fs;

    #[test]
    fn migrate_failure_renames_db_and_opens_fresh() {
        let dir = tempfile::tempdir().expect("temp");
        let paths = AppPaths::for_test(dir.path());

        // Seed a real library, then poison migrations so the next open fails migrate.
        {
            let (db, recovery) = Db::open(&paths).expect("first open");
            assert!(recovery.is_none());
            db.with_conn(|conn| {
                use crate::db::schema::roots::dsl as roots_dsl;
                diesel::insert_into(roots_dsl::roots)
                    .values((
                        roots_dsl::path.eq("/keep-me"),
                        roots_dsl::label.eq("keep-me"),
                    ))
                    .execute(conn)?;
                Ok(())
            })
            .expect("insert root");
        }
        assert!(paths.db_path.is_file());

        // Clear applied migrations so the next open re-runs CREATE TABLE on an
        // already-migrated DB and fails with migrate: ….
        {
            let mut conn =
                SqliteConnection::establish(paths.db_path.to_str().unwrap()).expect("reopen");
            conn.batch_execute("DELETE FROM __diesel_schema_migrations;")
                .expect("clear migrations");
        }

        let (db, recovery) = Db::open(&paths).expect("recover open");
        let recovery = recovery.expect("expected recovery info");
        assert!(
            recovery.backup_path.is_file(),
            "broken DB should be renamed, not deleted"
        );
        assert!(
            recovery
                .backup_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .contains(".bak-"),
            "backup name should include .bak- stamp"
        );
        assert!(
            recovery.migrate_error.contains("migrate:"),
            "recovery should carry the migrate error"
        );
        assert!(
            paths.db_path.is_file(),
            "fresh DB should exist at the original path"
        );
        // Fresh library has no user roots (taxonomy/settings only).
        let roots: i64 = db
            .with_conn(|conn| {
                use crate::db::schema::roots::dsl as roots_dsl;
                use diesel::dsl::count_star;
                Ok(roots_dsl::roots.select(count_star()).first(conn)?)
            })
            .expect("count roots");
        assert_eq!(roots, 0, "fresh DB must be empty of library roots");
        let backup_bytes = fs::metadata(&recovery.backup_path).unwrap().len();
        assert!(backup_bytes > 0);
    }

    #[test]
    fn lock_busy_does_not_backup_or_wipe() {
        let dir = tempfile::tempdir().expect("temp");
        let paths = AppPaths::for_test(dir.path());
        let (db, _) = Db::open(&paths).expect("seed");
        db.with_conn(|conn| {
            use crate::db::schema::roots::dsl as roots_dsl;
            diesel::insert_into(roots_dsl::roots)
                .values((roots_dsl::path.eq("/busy"), roots_dsl::label.eq("busy")))
                .execute(conn)?;
            Ok(())
        })
        .expect("insert");
        drop(db);

        // Hold an exclusive lock so a second open fails as locked/busy.
        let mut locker =
            SqliteConnection::establish(paths.db_path.to_str().unwrap()).expect("locker");
        locker
            .batch_execute("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;")
            .expect("exclusive lock");

        let Err(err) = Db::open(&paths) else {
            panic!("second open should fail while locked");
        };
        let msg = err.to_string();
        assert!(
            msg.to_ascii_lowercase().contains("already open"),
            "expected already-open error, got: {msg}"
        );

        // No backup rename; original DB still present with data.
        assert!(paths.db_path.is_file());
        let bak_count = fs::read_dir(paths.data_dir.as_path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".bak-"))
            .count();
        assert_eq!(bak_count, 0, "lock/busy must not create a backup");

        drop(locker);
    }

    #[test]
    fn is_lock_or_busy_detects_sqlite_messages() {
        assert!(is_lock_or_busy(&AppError::msg(
            "open db: database is locked"
        )));
        assert!(is_lock_or_busy(&AppError::msg("pragma: database is busy")));
        assert!(!is_lock_or_busy(&AppError::msg("migrate: no such table")));
    }
}
