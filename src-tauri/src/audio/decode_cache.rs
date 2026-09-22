//! In-memory LRU of fully decoded PCM for preview playback.
//!
//! Select→play and mid-file seeks re-use entries so Symphonia work is not
//! repeated for the same path. Entries are keyed by path and invalidated when
//! the file's mtime changes.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
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

    /// Return cached PCM or decode and insert. Second value is `true` on hit.
    pub fn get_or_decode(&mut self, path: &Path) -> AppResult<(Arc<DecodedAudio>, bool)> {
        let key = path.to_path_buf();
        let mtime = file_mtime(path);

        if let Some(entry) = self.entries.get(&key)
            && entry.mtime == mtime
        {
            let audio = Arc::clone(&entry.audio);
            self.touch(&key);
            return Ok((audio, true));
        }

        let audio = Arc::new(decode_file(path)?);
        self.insert(
            key,
            Entry {
                audio: Arc::clone(&audio),
                mtime,
            },
        );
        Ok((audio, false))
    }

    /// Warm the cache without returning PCM. Ignores decode errors.
    pub fn prefetch(&mut self, path: &Path) {
        let _ = self.get_or_decode(path);
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
        let mut cache = DecodeCache::new(4);
        let (a, hit1) = cache.get_or_decode(&path).expect("decode");
        let (b, hit2) = cache.get_or_decode(&path).expect("decode");
        assert!(!hit1);
        assert!(hit2);
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(cache.len(), 1);
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
        let mut cache = DecodeCache::new(2);
        cache.get_or_decode(&a).expect("a");
        cache.get_or_decode(&b).expect("b");
        // Touch a so b is oldest.
        let _ = cache.get_or_decode(&a).expect("a hit");
        cache.get_or_decode(&c).expect("c");
        assert_eq!(cache.len(), 2);
        assert!(cache.entries.contains_key(&a));
        assert!(cache.entries.contains_key(&c));
        assert!(!cache.entries.contains_key(&b));
    }
}
