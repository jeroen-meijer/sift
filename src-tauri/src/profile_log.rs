//! Runtime profiling gated by `SIFT_PROFILE=1`.
//!
//! Writes timestamped lines to `SIFT_PROFILE_LOG` (default:
//! `<repo>/logs/sift-profile.log` when that path is creatable, else the app
//! cache dir). Always mirrors to stderr so `tee` captures a live stream.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static ENABLED: OnceLock<bool> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static FILE: OnceLock<Mutex<fs::File>> = OnceLock::new();

fn enabled() -> bool {
    *ENABLED.get_or_init(|| {
        std::env::var_os("SIFT_PROFILE")
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    })
}

fn resolve_log_path(cache_dir: &Path) -> PathBuf {
    if let Some(p) = std::env::var_os("SIFT_PROFILE_LOG") {
        return PathBuf::from(p);
    }
    // Prefer a repo-local file when running from the workspace.
    let repo_log = PathBuf::from("logs").join("sift-profile.log");
    if repo_log
        .parent()
        .is_some_and(|d| fs::create_dir_all(d).is_ok())
    {
        return repo_log;
    }
    cache_dir.join("sift-profile.log")
}

/// Call once at startup (cache dir from [`crate::paths::AppPaths`]).
pub fn init(cache_dir: &Path) {
    if !enabled() {
        return;
    }
    let path = resolve_log_path(cache_dir);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // Truncate each profile session so the file is only this run.
    match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
    {
        Ok(file) => {
            let _ = LOG_PATH.set(path.clone());
            let _ = FILE.set(Mutex::new(file));
            log_line(&format!("profile session start path={}", path.display()));
            eprintln!("[sift-profile] writing to {}", path.display());
        }
        Err(e) => {
            eprintln!("[sift-profile] failed to open log {}: {e}", path.display());
        }
    }
}

pub fn log_path() -> Option<&'static Path> {
    LOG_PATH.get().map(PathBuf::as_path)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

fn log_line(msg: &str) {
    if !enabled() {
        return;
    }
    let line = format!("{}\t{}\n", now_ms(), msg);
    eprintln!("[sift-profile] {msg}");
    if let Some(lock) = FILE.get()
        && let Ok(mut f) = lock.lock()
    {
        let _ = f.write_all(line.as_bytes());
        let _ = f.flush();
    }
}

/// Log a named span that already finished.
pub fn event(name: &str, elapsed: Duration, detail: &str) {
    if !enabled() {
        return;
    }
    #[allow(
        clippy::as_conversions,
        clippy::cast_possible_truncation,
        reason = "log ms are display-only"
    )]
    let ms = elapsed.as_secs_f64() * 1000.0;
    if detail.is_empty() {
        log_line(&format!("{name}\t{ms:.2}ms"));
    } else {
        log_line(&format!("{name}\t{ms:.2}ms\t{detail}"));
    }
}

/// Time a closure when profiling is on; cheap when off (`OnceLock` load).
pub fn time<T>(name: &str, detail: &str, f: impl FnOnce() -> T) -> T {
    if !enabled() {
        return f();
    }
    let start = Instant::now();
    let out = f();
    event(name, start.elapsed(), detail);
    out
}

/// FE / IPC marks that already measured duration on the other side.
pub fn mark(name: &str, ms: f64, detail: &str) {
    if !enabled() {
        return;
    }
    if detail.is_empty() {
        log_line(&format!("{name}\t{ms:.2}ms"));
    } else {
        log_line(&format!("{name}\t{ms:.2}ms\t{detail}"));
    }
}

pub fn is_enabled() -> bool {
    enabled()
}
