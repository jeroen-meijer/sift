//! In-memory LRU of fully decoded PCM for preview playback.
//!
//! Select-to-play and mid-file seeks re-use entries so Symphonia work is not
//! repeated for the same path. Entries are keyed by path and invalidated when
//! the file's mtime changes. Eviction is by decoded byte budget, not entry count.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use crate::audio::decode::{DecodedAudio, decode_file};
use crate::error::AppResult;

/// Default audition cache: ~256 MB of interleaved f32 PCM.
const DEFAULT_BUDGET_BYTES: u64 = 256 * 1024 * 1024;

struct Entry {
    audio: Arc<DecodedAudio>,
    mtime: Option<SystemTime>,
    bytes: u64,
}

/// Bounded decode cache shared by preview play and prefetch.
pub struct DecodeCache {
    entries: HashMap<PathBuf, Entry>,
    /// Oldest at the front; most recently used at the back.
    order: VecDeque<PathBuf>,
    budget_bytes: u64,
    used_bytes: u64,
}

impl Default for DecodeCache {
    fn default() -> Self {
        Self::new(DEFAULT_BUDGET_BYTES)
    }
}

impl DecodeCache {
    pub fn new(budget_bytes: u64) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            budget_bytes: budget_bytes.max(1),
            used_bytes: 0,
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

    /// Insert decoded PCM, evicting oldest entries until it fits.
    /// An entry larger than the whole budget is returned to the caller but not retained.
    pub fn insert_decoded(
        &mut self,
        path: PathBuf,
        audio: Arc<DecodedAudio>,
        mtime: Option<SystemTime>,
    ) {
        let bytes = pcm_bytes(&audio);
        self.insert(
            path,
            Entry {
                audio,
                mtime,
                bytes,
            },
        );
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub const fn used_bytes(&self) -> u64 {
        self.used_bytes
    }

    fn insert(&mut self, key: PathBuf, entry: Entry) {
        if let Some(old) = self.entries.remove(&key) {
            self.used_bytes = self.used_bytes.saturating_sub(old.bytes);
            if let Some(pos) = self.order.iter().position(|p| p == &key) {
                self.order.remove(pos);
            }
        }

        if entry.bytes > self.budget_bytes {
            // Too big to cache; leave the map clean for this path.
            return;
        }

        while self.used_bytes.saturating_add(entry.bytes) > self.budget_bytes {
            if let Some(old_key) = self.order.pop_front() {
                if let Some(old) = self.entries.remove(&old_key) {
                    self.used_bytes = self.used_bytes.saturating_sub(old.bytes);
                }
            } else {
                break;
            }
        }

        self.used_bytes = self.used_bytes.saturating_add(entry.bytes);
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

fn pcm_bytes(audio: &DecodedAudio) -> u64 {
    u64::try_from(audio.samples.len())
        .unwrap_or(u64::MAX)
        .saturating_mul(4)
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

    fn band_probe() -> Option<PathBuf> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../testdata/spectral-fixtures/band-probe.wav");
        path.exists().then_some(path)
    }

    fn tiny(samples: usize) -> Arc<DecodedAudio> {
        Arc::new(DecodedAudio {
            sample_rate: 44_100,
            channels: 1,
            bit_depth_hint: Some(16),
            samples: vec![0.0; samples],
        })
    }

    #[test]
    fn cache_hit_skips_second_decode() {
        let Some(path) = band_probe() else {
            eprintln!("skip: missing band-probe fixture");
            return;
        };
        let cache = Mutex::new(DecodeCache::new(64 * 1024 * 1024));
        let (a, hit1) = get_or_decode(&cache, &path).expect("decode");
        let (b, hit2) = get_or_decode(&cache, &path).expect("decode");
        assert!(!hit1);
        assert!(hit2);
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(lock(&cache).len(), 1);
    }

    #[test]
    fn lru_evicts_oldest_by_bytes() {
        let mut cache = DecodeCache::new(100); // 25 samples * 4 = 100 bytes fits two of 50-byte entries
        let a = PathBuf::from("/a");
        let b = PathBuf::from("/b");
        let c = PathBuf::from("/c");
        cache.insert_decoded(a.clone(), tiny(12), None); // 48 bytes
        cache.insert_decoded(b.clone(), tiny(12), None); // 48 bytes, used 96
        // Touch a so b is oldest.
        let _ = cache.get_fresh(&a);
        cache.insert_decoded(c.clone(), tiny(12), None);
        assert_eq!(cache.len(), 2);
        assert!(cache.entries.contains_key(&a));
        assert!(!cache.entries.contains_key(&b));
        assert!(cache.entries.contains_key(&c));
    }

    #[test]
    fn entry_larger_than_budget_is_not_retained() {
        let mut cache = DecodeCache::new(40);
        cache.insert_decoded(PathBuf::from("/big"), tiny(20), None); // 80 bytes
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.used_bytes(), 0);
    }

    #[test]
    fn lock_is_free_while_decoding() {
        let Some(path) = band_probe() else {
            return;
        };
        let cache = std::sync::Arc::new(Mutex::new(DecodeCache::new(64 * 1024 * 1024)));
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
