import { ipc, type PeakData } from "../lib/ipc";

/** Peaks are immutable per sample; one cache covers every row that scrolls by. */
const peakCache = new Map<number, PeakData>();

/**
 * Cap concurrent get_peaks IPC. Uncached peaks decode + FFT on the Rust side;
 * flooding the bridge freezes the UI on first scroll through a library.
 */
const MAX_INFLIGHT = 2;

interface QueuedLoad {
  id: number;
  resolve: (data: PeakData | null) => void;
}

/** Pending loads; front of the queue is higher priority (visible rows). */
const waitQueue: QueuedLoad[] = [];
/** sampleId → promise for dedupe across prefetch + row mount. */
const pending = new Map<number, Promise<PeakData | null>>();
let active = 0;

function pump(): void {
  while (active < MAX_INFLIGHT && waitQueue.length > 0) {
    const job = waitQueue.shift();
    if (!job) break;
    active += 1;
    void ipc
      .getPeaks(job.id)
      .then((data) => {
        peakCache.set(job.id, data);
        job.resolve(data);
      })
      .catch((err: unknown) => {
        job.resolve(null);
        void err;
      })
      .finally(() => {
        pending.delete(job.id);
        active = Math.max(0, active - 1);
        pump();
      });
  }
}

function enqueue(id: number, urgent: boolean): Promise<PeakData | null> {
  const cached = peakCache.get(id);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(id);
  if (existing) {
    if (urgent) {
      /* Promote: move this id to the front if still waiting. */
      const idx = waitQueue.findIndex((j) => j.id === id);
      if (idx > 0) {
        const [job] = waitQueue.splice(idx, 1);
        if (job) waitQueue.unshift(job);
      }
    }
    return existing;
  }

  const promise = new Promise<PeakData | null>((resolve) => {
    const job: QueuedLoad = { id, resolve };
    if (urgent) waitQueue.unshift(job);
    else waitQueue.push(job);
    pump();
  });
  pending.set(id, promise);
  return promise;
}

export function cachedRowPeaks(sampleId: number): PeakData | null {
  return peakCache.get(sampleId) ?? null;
}

export function loadRowPeaks(sampleId: number): Promise<PeakData | null> {
  return enqueue(sampleId, true);
}

/** Warm the cache. `urgent` promotes ids ahead of background prefetch. */
export function prefetchRowPeaks(
  sampleIds: Iterable<number>,
  opts?: { urgent?: boolean },
): void {
  const urgent = opts?.urgent ?? false;
  for (const id of sampleIds) {
    void enqueue(id, urgent);
  }
}

/** Test helper: drop caches between cases. */
export function __resetRowPeaksForTests(): void {
  peakCache.clear();
  pending.clear();
  waitQueue.length = 0;
  active = 0;
}
