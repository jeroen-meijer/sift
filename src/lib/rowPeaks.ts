import { ipc, type PeakData } from "../lib/ipc";
import { isProfileOn, profileEvent, profileMark } from "./profile";

/**
 * Row waveform peaks: a bounded cache that rows subscribe to by id, plus a
 * small fetch queue that only ever holds what is on screen.
 *
 * `requestVisible` replaces the queue each time the visible range settles, so
 * rows that scrolled away are never fetched. Rows read with
 * `useSyncExternalStore(subscribeRowPeaks(id), getRowPeaks(id))`, so a
 * recycled row never shows the previous sample's wave.
 */

/** Concurrent get_peaks calls. The Rust side runs them off the main thread. */
const MAX_INFLIGHT = 6;
/** ~1024-bucket stereo peaks are ~50 KB each as JS arrays; 1 500 ≈ 75 MB max. */
const MAX_ENTRIES = 1500;

const cache = new Map<number, PeakData>(); // insertion order = LRU order
/** Cached ids whose data changed on disk (re-analyzed); refetch when visible. */
const stale = new Set<number>();
const listeners = new Map<number, Set<() => void>>();
/** Ids to fetch, most important first. Replaced on every `requestVisible`. */
let wanted: number[] = [];
const wantedAt = new Map<number, number>();
const inflight = new Set<number>();

function queueDetail(): string {
  return `active=${String(inflight.size)} queued=${String(wanted.length)} cache=${String(cache.size)}`;
}

function notify(id: number): void {
  const set = listeners.get(id);
  if (!set) return;
  for (const fn of set) fn();
}

function setEntry(id: number, data: PeakData): void {
  cache.delete(id);
  cache.set(id, data);
  stale.delete(id);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  notify(id);
}

function pump(): void {
  while (inflight.size < MAX_INFLIGHT && wanted.length > 0) {
    const id = wanted.shift();
    if (id === undefined) break;
    inflight.add(id);
    const waitMs = performance.now() - (wantedAt.get(id) ?? performance.now());
    wantedAt.delete(id);
    if (isProfileOn()) {
      profileMark("fe.peaks_start", waitMs, `id=${String(id)} ${queueDetail()}`);
    }
    const ipcAt = performance.now();
    void ipc
      .getPeaks(id, false)
      .then((data) => {
        setEntry(id, data);
        if (isProfileOn()) {
          profileMark(
            "fe.peaks_done",
            performance.now() - ipcAt,
            `id=${String(id)} wait_ms=${waitMs.toFixed(1)} ${queueDetail()}`,
          );
        }
      })
      .catch(() => {
        if (isProfileOn()) profileEvent("fe.peaks_err", `id=${String(id)}`);
      })
      .finally(() => {
        inflight.delete(id);
        pump();
      });
  }
}

export function getRowPeaks(id: number): PeakData | undefined {
  return cache.get(id);
}

export function subscribeRowPeaks(id: number, fn: () => void): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(fn);
  return () => {
    const current = listeners.get(id);
    if (!current) return;
    current.delete(fn);
    if (current.size === 0) listeners.delete(id);
  };
}

/**
 * Fetch peaks for what is on screen. Anything queued earlier that is not in
 * `ids` is dropped. Call when the visible range settles (not while scrolling).
 */
export function requestVisible(ids: readonly number[]): void {
  const now = performance.now();
  const next: number[] = [];
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && !stale.has(id)) {
      /* Keep visible rows at the fresh end of the LRU. */
      cache.delete(id);
      cache.set(id, hit);
      continue;
    }
    if (inflight.has(id)) continue;
    next.push(id);
    if (!wantedAt.has(id)) wantedAt.set(id, now);
  }
  for (const id of wantedAt.keys()) {
    if (!next.includes(id)) wantedAt.delete(id);
  }
  wanted = next;
  if (isProfileOn() && next.length > 0) {
    profileEvent("fe.peaks_wanted", `n=${String(next.length)} ${queueDetail()}`);
  }
  pump();
}

/**
 * Samples analyzed (or re-analyzed) on the backend: keep showing what we have
 * (a wave, or the `bucket_count: 0` placeholder for "not analyzed yet") and
 * refetch when visible.
 */
export function invalidateRowPeaks(ids: readonly number[]): void {
  for (const id of ids) {
    if (cache.has(id)) stale.add(id);
  }
}

/** Snapshot for scroll / range marks. */
export function peaksQueueSnapshot(): { active: number; queued: number; cache: number } {
  return { active: inflight.size, queued: wanted.length, cache: cache.size };
}

/** Test helper: drop caches between cases. */
export function __resetRowPeaksForTests(): void {
  cache.clear();
  stale.clear();
  listeners.clear();
  wanted = [];
  wantedAt.clear();
  inflight.clear();
}
