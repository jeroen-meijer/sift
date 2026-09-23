//! Runtime profiling gated by `SIFT_PROFILE=1`.
//!
//! Writes timestamped lines to `SIFT_PROFILE_LOG` (default:
//! `<repo>/logs/sift-profile.log` when that path is creatable, else the app
//! cache dir). Lines go over a channel to one writer thread, so callers (the
//! main thread, analyze workers) never wait on file I/O. Set
//! `SIFT_PROFILE_STDERR=1` to also mirror lines to stderr.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static ENABLED: OnceLock<bool> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static TX: OnceLock<Mutex<Sender<String>>> = OnceLock::new();
static EMITS: OnceLock<Mutex<EmitCounts>> = OnceLock::new();

/// How often per-event emit counts are written.
const EMIT_WINDOW: Duration = Duration::from_secs(10);

struct EmitCounts {
    since: Instant,
    counts: HashMap<&'static str, u64>,
}

fn enabled() -> bool {
    *ENABLED.get_or_init(|| {
        std::env::var_os("SIFT_PROFILE").is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
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
    let file = match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
    {
        Ok(file) => file,
        Err(e) => {
            eprintln!("[sift-profile] failed to open log {}: {e}", path.display());
            return;
        }
    };
    let (tx, rx) = channel::<String>();
    let echo = std::env::var_os("SIFT_PROFILE_STDERR").is_some();
    let spawned = std::thread::Builder::new()
        .name("sift-profile-log".into())
        .spawn(move || {
            let mut out = BufWriter::with_capacity(64 * 1024, file);
            while let Ok(line) = rx.recv() {
                write_one(&mut out, &line, echo);
                // Drain what is already queued, then flush once.
                while let Ok(more) = rx.try_recv() {
                    write_one(&mut out, &more, echo);
                }
                let _ = out.flush();
            }
        });
    if let Err(e) = spawned {
        eprintln!("[sift-profile] failed to start writer: {e}");
        return;
    }
    let _ = LOG_PATH.set(path.clone());
    let _ = TX.set(Mutex::new(tx));
    log_line(&format!("profile session start path={}", path.display()));
    eprintln!("[sift-profile] writing to {}", path.display());
}

fn write_one(out: &mut BufWriter<fs::File>, line: &str, echo: bool) {
    if echo {
        eprint!("[sift-profile] {line}");
    }
    let _ = out.write_all(line.as_bytes());
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
    if let Some(lock) = TX.get() {
        let tx = lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let _ = tx.send(format!("{}\t{}\n", now_ms(), msg));
    }
}

/// Log a named span that already finished.
pub fn event(name: &str, elapsed: Duration, detail: &str) {
    if !enabled() {
        return;
    }
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

/// Count one backend → FE event. Every [`EMIT_WINDOW`] the counts are logged
/// as `ipc.emit name=... n=...` and reset.
pub fn count_emit(name: &'static str) {
    if !enabled() {
        return;
    }
    let lock = EMITS.get_or_init(|| {
        Mutex::new(EmitCounts {
            since: Instant::now(),
            counts: HashMap::new(),
        })
    });
    let mut st = lock
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let n = st.counts.entry(name).or_insert(0);
    *n = n.saturating_add(1);
    let window = st.since.elapsed();
    if window < EMIT_WINDOW {
        return;
    }
    let lines: Vec<String> = st
        .counts
        .iter()
        .map(|(k, v)| format!("name={k} n={v} window_s={}", window.as_secs()))
        .collect();
    st.counts.clear();
    st.since = Instant::now();
    drop(st);
    for line in lines {
        log_line(&format!("ipc.emit\t0.00ms\t{line}"));
    }
}

pub fn is_enabled() -> bool {
    enabled()
}
