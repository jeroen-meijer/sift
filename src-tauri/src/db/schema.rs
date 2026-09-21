use rusqlite::Connection;

use crate::error::AppResult;

pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS roots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            label TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE TABLE IF NOT EXISTS samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
            path TEXT NOT NULL UNIQUE,
            filename TEXT NOT NULL,
            parent_path TEXT NOT NULL,
            extension TEXT NOT NULL,
            size_bytes INTEGER,
            mtime_ms INTEGER,
            inode INTEGER,
            missing INTEGER NOT NULL DEFAULT 0,
            sample_rate INTEGER,
            bit_depth INTEGER,
            channels INTEGER,
            duration_ms REAL,
            format TEXT,
            bpm REAL,
            bpm_confidence REAL,
            key_name TEXT,
            key_confidence REAL,
            sample_type TEXT,
            favorite INTEGER NOT NULL DEFAULT 0,
            analyzed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE INDEX IF NOT EXISTS idx_samples_root ON samples(root_id);
        CREATE INDEX IF NOT EXISTS idx_samples_parent ON samples(parent_path);
        CREATE INDEX IF NOT EXISTS idx_samples_filename ON samples(filename);
        CREATE INDEX IF NOT EXISTS idx_samples_bpm ON samples(bpm);
        CREATE INDEX IF NOT EXISTS idx_samples_key ON samples(key_name);
        CREATE INDEX IF NOT EXISTS idx_samples_type ON samples(sample_type);
        CREATE INDEX IF NOT EXISTS idx_samples_favorite ON samples(favorite);
        CREATE INDEX IF NOT EXISTS idx_samples_missing ON samples(missing);

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            parent_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            color TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);

        CREATE TABLE IF NOT EXISTS sample_tags (
            sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
            tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            source TEXT NOT NULL DEFAULT 'user',
            PRIMARY KEY (sample_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS tag_rejects (
            sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
            tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (sample_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS favorite_folders (
            path TEXT PRIMARY KEY NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE TABLE IF NOT EXISTS undo_stack (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            action_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS redo_stack (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            action_json TEXT NOT NULL
        );
        "#,
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1')",
        [],
    )?;
    Ok(())
}
