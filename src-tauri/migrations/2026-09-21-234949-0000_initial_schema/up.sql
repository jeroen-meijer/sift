CREATE TABLE meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE roots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    parent_path TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes BIGINT,
    mtime_ms BIGINT,
    inode BIGINT,
    missing INTEGER NOT NULL DEFAULT 0,
    sample_rate INTEGER,
    bit_depth INTEGER,
    channels INTEGER,
    duration_ms DOUBLE,
    format TEXT,
    bpm DOUBLE,
    bpm_confidence DOUBLE,
    key_name TEXT,
    key_confidence DOUBLE,
    sample_type TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    analyzed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_samples_root ON samples(root_id);
CREATE INDEX idx_samples_parent ON samples(parent_path);
CREATE INDEX idx_samples_filename ON samples(filename);
CREATE INDEX idx_samples_bpm ON samples(bpm);
CREATE INDEX idx_samples_key ON samples(key_name);
CREATE INDEX idx_samples_type ON samples(sample_type);
CREATE INDEX idx_samples_favorite ON samples(favorite);
CREATE INDEX idx_samples_missing ON samples(missing);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_tags_parent ON tags(parent_id);

CREATE TABLE sample_tags (
    sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'user',
    PRIMARY KEY (sample_id, tag_id)
);

CREATE TABLE tag_rejects (
    sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (sample_id, tag_id)
);

CREATE TABLE favorite_folders (
    path TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE undo_stack (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    action_json TEXT NOT NULL
);

CREATE TABLE redo_stack (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    action_json TEXT NOT NULL
);
