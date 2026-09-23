pub mod models;
pub mod schema;
pub mod settings;
pub mod taxonomy;

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

pub struct Db {
    conn: Mutex<SqliteConnection>,
}

impl Db {
    pub fn open(paths: &AppPaths) -> AppResult<Self> {
        match Self::open_inner(paths) {
            Ok(db) => Ok(db),
            Err(e) => {
                // Pre-Diesel DBs lack `__diesel_schema_migrations`. Wipe index once and retry.
                // Sample files on disk are never touched.
                let msg = e.to_string();
                if msg.contains("migrate:") {
                    let _ = std::fs::remove_file(&paths.db_path);
                    let wal = format!("{}-wal", paths.db_path.display());
                    let shm = format!("{}-shm", paths.db_path.display());
                    let _ = std::fs::remove_file(&wal);
                    let _ = std::fs::remove_file(&shm);
                    Self::open_inner(paths)
                } else {
                    Err(e)
                }
            }
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

/// In-memory database with all migrations, for unit tests.
#[cfg(test)]
pub fn test_conn() -> SqliteConnection {
    let mut conn = SqliteConnection::establish(":memory:").expect("in-memory db");
    conn.run_pending_migrations(MIGRATIONS).expect("migrations");
    conn
}
