//! In-memory LRU of fully decoded PCM for preview playback.
//!
//! Select→play and mid-file seeks re-use entries so Symphonia work is not
//! repeated for the same path. Entries are keyed by path and invalidated when
//! the file's mtime changes.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use crate::audio::decode::{DecodedAudio, decode_file};
use crate::error::AppResult;

const DEFAULT_CAPACITY: usize = 16;

struct Entry {
    audio: Arc<DecodedAudio>,
    mtime: Option<SystemTime>,
}

/// Bounded decode cache shared by preview play and prefetch.
pub struct DecodeCache {
    entries: HashMap<PathBuf, Entry>,
    /// Oldest at the front; most recently used at the back.
    order: VecDeque<PathBuf>,
    capacity: usize,
}

impl Default for DecodeCache {
    fn default() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }
}

impl DecodeCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    /// Cached PCM for `path` if present and the file's mtime still matches.
    pub fn get_fresh(&mut self, path: &Path) -> Option<Arc<DecodedAudio>> {
        let mtime = file_mtime(path);
        let entry = self.entries.get(path)?;
        if entry.mtime != mtime {
            return None;
        }
        let audio = Arc::clone(&entry.audio);
        self.touch(path);
        Some(audio)
    }

    /// Insert decoded PCM, evicting the oldest entries past capacity.
    pub fn insert_decoded(
        &mut self,
        path: PathBuf,
        audio: Arc<DecodedAudio>,
        mtime: Option<SystemTime>,
    ) {
        self.insert(path, Entry { audio, mtime });
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    fn insert(&mut self, key: PathBuf, entry: Entry) {
        if self.entries.contains_key(&key) {
            self.entries.insert(key.clone(), entry);
            self.touch(&key);
            return;
        }
        while self.entries.len() >= self.capacity {
            if let Some(old) = self.order.pop_front() {
                self.entries.remove(&old);
            } else {
                break;
            }
        }
        self.order.push_back(key.clone());
        self.entries.insert(key, entry);
    }

    fn touch(&mut self, key: &Path) {
        if let Some(pos) = self.order.iter().position(|p| p == key)
            && let Some(k) = self.order.remove(pos)
        {
            self.order.push_back(k);
        }
    }
}

/// Return cached PCM or decode and insert. Second value is `true` on hit.
///
/// The cache lock is held only to look up and to insert, never during the
/// decode, so a slow decode (prefetch, long file) cannot block play.
/// Two concurrent misses on one path may both decode; the second insert wins.
pub fn get_or_decode(
    cache: &Mutex<DecodeCache>,
    path: &Path,
) -> AppResult<(Arc<DecodedAudio>, bool)> {
    let hit = lock(cache).get_fresh(path);
    if let Some(hit) = hit {
        return Ok((hit, true));
    }
    let mtime = file_mtime(path);
    let audio = Arc::new(decode_file(path)?);
    lock(cache).insert_decoded(path.to_path_buf(), Arc::clone(&audio), mtime);
    Ok((audio, false))
}

/// Warm the cache without returning PCM. Ignores decode errors.
pub fn prefetch(cache: &Mutex<DecodeCache>, path: &Path) {
    let _ = get_or_decode(cache, path);
}

fn lock(cache: &Mutex<DecodeCache>) -> std::sync::MutexGuard<'_, DecodeCache> {
    cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(rel: &str) -> Option<PathBuf> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../example_samples")
            .join(rel);
        path.exists().then_some(path)
    }

    #[test]
    fn cache_hit_skips_second_decode() {
        let Some(path) = fixture("amen_breaks/cw_amen_chopper.wav") else {
            eprintln!("skip: missing amen chopper fixture");
            return;
        };
        let cache = Mutex::new(DecodeCache::new(4));
        let (a, hit1) = get_or_decode(&cache, &path).expect("decode");
        let (b, hit2) = get_or_decode(&cache, &path).expect("decode");
        assert!(!hit1);
        assert!(hit2);
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(lock(&cache).len(), 1);
    }

    #[test]
    fn lru_evicts_oldest() {
        let Some(a) = fixture("amen_breaks/cw_amen_chopper.wav") else {
            return;
        };
        let Some(b) = fixture("heatwave/Moods/mood-hopeful.wav") else {
            return;
        };
        let Some(c) = fixture("amen_breaks/cw_amen_distorted.mp3") else {
            return;
        };
        let cache = Mutex::new(DecodeCache::new(2));
        get_or_decode(&cache, &a).expect("a");
        get_or_decode(&cache, &b).expect("b");
        // Touch a so b is oldest.
        let _ = get_or_decode(&cache, &a).expect("a hit");
        get_or_decode(&cache, &c).expect("c");
        let (len, has_a, has_b, has_c) = {
            let guard = lock(&cache);
            (
                guard.len(),
                guard.entries.contains_key(&a),
                guard.entries.contains_key(&b),
                guard.entries.contains_key(&c),
            )
        };
        assert_eq!(len, 2);
        assert!(has_a && has_c && !has_b);
    }

    #[test]
    fn lock_is_free_while_decoding() {
        let Some(path) = fixture("heatwave/Moods/mood-hopeful.wav") else {
            return;
        };
        let cache = std::sync::Arc::new(Mutex::new(DecodeCache::new(4)));
        let worker = {
            let cache = std::sync::Arc::clone(&cache);
            std::thread::spawn(move || get_or_decode(&cache, &path).map(|(_, hit)| hit))
        };
        // While the other thread decodes, the lock must be available.
        let mut free_seen = false;
        while !worker.is_finished() {
            if cache.try_lock().is_ok() {
                free_seen = true;
            }
            std::thread::yield_now();
        }
        assert!(!worker.join().expect("join").expect("decode"));
        assert!(free_seen);
    }
}
