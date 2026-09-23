import { ipc, type PeakData } from "../lib/ipc";
import { isProfileOn, profileEvent, profileMark } from "./profile";

/** Peaks are immutable per sample; one cache covers every row that scrolls by. */
const peakCache = new Map<number, PeakData>();

/**
 * Cap concurrent get_peaks IPC. Uncached peaks decode on the Rust side.
 * Flooding the bridge freezes the UI on first scroll through a large library.
 */
const MAX_INFLIGHT = 2;

interface QueuedLoad {
  id: number;
  resolve: (data: PeakData | null) => void;
  enqueuedAt: number;
  urgent: boolean;
}

/** Pending loads; front of the queue is higher priority (visible rows). */
const waitQueue: QueuedLoad[] = [];
/** sampleId → promise for dedupe across prefetch + row mount. */
const pending = new Map<number, Promise<PeakData | null>>();
let active = 0;
let enqueueSeq = 0;

function queueDetail(): string {
  return `active=${String(active)} queued=${String(waitQueue.length)} pending=${String(pending.size)} cache=${String(peakCache.size)}`;
}

function pump(): void {
  while (active < MAX_INFLIGHT && waitQueue.length > 0) {
    const job = waitQueue.shift();
    if (!job) break;
    active += 1;
    const waitMs = performance.now() - job.enqueuedAt;
    if (isProfileOn()) {
      profileMark(
        "fe.peaks_start",
        waitMs,
        `id=${String(job.id)} urgent=${String(job.urgent)} ${queueDetail()}`,
      );
    }
    const ipcAt = performance.now();
    void ipc
      .getPeaks(job.id)
      .then((data) => {
        peakCache.set(job.id, data);
        if (isProfileOn()) {
          profileMark(
            "fe.peaks_done",
            performance.now() - ipcAt,
            `id=${String(job.id)} wait_ms=${waitMs.toFixed(1)} ${queueDetail()}`,
          );
        }
        job.resolve(data);
      })
      .catch((err: unknown) => {
        if (isProfileOn()) {
          profileMark(
            "fe.peaks_err",
            performance.now() - ipcAt,
            `id=${String(job.id)} ${queueDetail()}`,
          );
        }
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
  if (cached) {
    if (isProfileOn()) {
      profileEvent("fe.peaks_cache", `id=${String(id)}`);
    }
    return Promise.resolve(cached);
  }
  const existing = pending.get(id);
  if (existing) {
    if (urgent) {
      /* Promote: move this id to the front if still waiting. */
      const idx = waitQueue.findIndex((j) => j.id === id);
      if (idx > 0) {
        const [job] = waitQueue.splice(idx, 1);
        if (job) {
          job.urgent = true;
          waitQueue.unshift(job);
          if (isProfileOn()) {
            profileEvent("fe.peaks_promote", `id=${String(id)} from=${String(idx)}`);
          }
        }
      }
    }
    return existing;
  }

  enqueueSeq += 1;
  const enqueuedAt = performance.now();
  const promise = new Promise<PeakData | null>((resolve) => {
    const job: QueuedLoad = { id, resolve, enqueuedAt, urgent };
    if (urgent) waitQueue.unshift(job);
    else waitQueue.push(job);
    if (isProfileOn()) {
      profileEvent(
        "fe.peaks_enqueue",
        `id=${String(id)} urgent=${String(urgent)} seq=${String(enqueueSeq)} ${queueDetail()}`,
      );
    }
    pump();
  });
  pending.set(id, promise);
  return promise;
}

export function cachedRowPeaks(sampleId: number): PeakData | null {
  return peakCache.get(sampleId) ?? null;
}

export function loadRowPeaks(sampleId: number, availability?: string): Promise<PeakData | null> {
  if (availability && availability !== "local") {
    if (isProfileOn()) {
      profileEvent("fe.peaks_skip", `id=${String(sampleId)} avail=${availability}`);
    }
    return Promise.resolve(null);
  }
  return enqueue(sampleId, true);
}

/** Warm the cache. `urgent` promotes ids ahead of background prefetch. */
export function prefetchRowPeaks(
  sampleIds: Iterable<number>,
  opts?: { urgent?: boolean; availabilityById?: Map<number, string> },
): void {
  const urgent = opts?.urgent ?? false;
  const avail = opts?.availabilityById;
  let n = 0;
  let skipped = 0;
  for (const id of sampleIds) {
    if (avail && avail.get(id) !== "local") {
      skipped += 1;
      continue;
    }
    n += 1;
    void enqueue(id, urgent);
  }
  if (isProfileOn() && (n > 0 || skipped > 0)) {
    profileEvent(
      "fe.peaks_prefetch",
      `n=${String(n)} skipped=${String(skipped)} urgent=${String(urgent)} ${queueDetail()}`,
    );
  }
}

/** Snapshot for scroll / range marks. */
export function peaksQueueSnapshot(): {
  active: number;
  queued: number;
  pending: number;
  cache: number;
} {
  return {
    active,
    queued: waitQueue.length,
    pending: pending.size,
    cache: peakCache.size,
  };
}

/** Test helper: drop caches between cases. */
export function __resetRowPeaksForTests(): void {
  peakCache.clear();
  pending.clear();
  waitQueue.length = 0;
  active = 0;
  enqueueSeq = 0;
}
