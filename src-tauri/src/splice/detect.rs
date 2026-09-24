//! Locate Splice Desktop's `sounds.db` on disk (auto-detect only).

use std::fs;
use std::path::{Path, PathBuf};

use directories::BaseDirs;

#[derive(Debug, Clone)]
pub struct DetectResult {
    pub path: PathBuf,
    /// Optional `splice_folder` from sibling `settings.json`.
    pub splice_folder: Option<String>,
}

/// Find the newest `sounds.db` under known Splice Application Support roots.
pub fn detect_sounds_db() -> Option<DetectResult> {
    if let Ok(override_path) = std::env::var("SIFT_SPLICE_DB") {
        let path = PathBuf::from(override_path);
        if path.is_file() {
            let splice_folder = read_splice_folder(&path);
            return Some(DetectResult {
                path,
                splice_folder,
            });
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in candidate_roots() {
        collect_sounds_dbs(&root, &mut candidates);
    }
    candidates.sort_by_key(|p| {
        fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    let path = candidates.pop()?;
    let splice_folder = read_splice_folder(&path);
    Some(DetectResult {
        path,
        splice_folder,
    })
}

fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let Some(base) = BaseDirs::new() else {
        return roots;
    };

    #[cfg(target_os = "macos")]
    {
        roots.push(
            base.home_dir()
                .join("Library/Application Support/com.splice.Splice"),
        );
    }

    #[cfg(target_os = "windows")]
    {
        // Electron userData is usually Roaming; support docs also mention Local.
        roots.push(base.config_dir().join("com.splice.Splice"));
        roots.push(base.data_local_dir().join("com.splice.Splice"));
        roots.push(base.config_dir().join("Splice"));
        roots.push(base.data_local_dir().join("Splice"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        roots.push(base.config_dir().join("com.splice.Splice"));
        roots.push(base.data_local_dir().join("com.splice.Splice"));
    }

    roots
}

fn collect_sounds_dbs(root: &Path, out: &mut Vec<PathBuf>) {
    if !root.is_dir() {
        return;
    }
    // Typical layout: users/default/<username>/sounds.db
    let users = root.join("users").join("default");
    if users.is_dir() {
        let Ok(entries) = fs::read_dir(&users) else {
            return;
        };
        for entry in entries.flatten() {
            let db = entry.path().join("sounds.db");
            if db.is_file() {
                out.push(db);
            }
        }
    }
    // Fallback: any sounds.db under the root (shallow-ish walk).
    if out.is_empty() {
        walk_for_sounds_db(root, 0, out);
    }
}

fn walk_for_sounds_db(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_for_sounds_db(&path, depth.saturating_add(1), out);
        } else if path.file_name().and_then(|s| s.to_str()) == Some("sounds.db") {
            out.push(path);
        }
    }
}

fn read_splice_folder(sounds_db: &Path) -> Option<String> {
    let settings = sounds_db.parent()?.join("settings.json");
    let text = fs::read_to_string(settings).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("splice_folder")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_under_users_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        let user = dir.path().join("users").join("default").join("tester");
        fs::create_dir_all(&user).expect("mkdir");
        let db = user.join("sounds.db");
        fs::write(&db, b"").expect("write");
        let mut found = Vec::new();
        collect_sounds_dbs(dir.path(), &mut found);
        assert_eq!(found, vec![db]);
    }
}
