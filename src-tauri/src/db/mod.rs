pub mod schema;
pub mod settings;
pub mod taxonomy;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::error::AppResult;
use crate::paths::AppPaths;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(paths: &AppPaths) -> AppResult<Self> {
        let conn = Connection::open(&paths.db_path)?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            ",
        )?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        {
            let conn = db.conn.lock().expect("db lock");
            schema::migrate(&conn)?;
            settings::ensure_defaults(&conn, paths)?;
            taxonomy::seed_if_empty(&conn)?;
        }
        Ok(db)
    }

    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self.conn.lock().expect("db lock");
        f(&conn)
    }

    pub fn path_exists(path: &Path) -> bool {
        path.exists()
    }
}
