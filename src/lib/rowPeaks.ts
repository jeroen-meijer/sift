import { ipc, type PeakData } from "../lib/ipc";

/** Peaks are immutable per sample; one cache covers every row that scrolls by. */
const peakCache = new Map<number, PeakData>();
const inFlight = new Map<number, Promise<PeakData | null>>();

export function cachedRowPeaks(sampleId: number): PeakData | null {
  return peakCache.get(sampleId) ?? null;
}

export function loadRowPeaks(sampleId: number): Promise<PeakData | null> {
  const cached = peakCache.get(sampleId);
  if (cached) return Promise.resolve(cached);
  const existing = inFlight.get(sampleId);
  if (existing) return existing;
  const request = ipc
    .getPeaks(sampleId)
    .then((data) => {
      peakCache.set(sampleId, data);
      return data;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(sampleId));
  inFlight.set(sampleId, request);
  return request;
}

/** Warm the cache for rows about to enter the viewport (fire-and-forget). */
export function prefetchRowPeaks(sampleIds: Iterable<number>): void {
  for (const id of sampleIds) {
    if (peakCache.has(id) || inFlight.has(id)) continue;
    void loadRowPeaks(id);
  }
}
