import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPeaks = vi.fn();

vi.mock("./ipc", () => ({
  ipc: {
    getPeaks: (id: number) => getPeaks(id) as Promise<unknown>,
  },
}));

import {
  __resetRowPeaksForTests,
  getRowPeaks,
  invalidateRowPeaks,
  peaksQueueSnapshot,
  requestVisible,
  subscribeRowPeaks,
} from "./rowPeaks";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function peaks(id: number) {
  return {
    channels: 1,
    sample_rate: 44100,
    duration_ms: id,
    bucket_count: 1,
    peaks: [0, 0],
    colors: [0, 0, 0],
  };
}

describe("rowPeaks", () => {
  beforeEach(() => {
    __resetRowPeaksForTests();
    getPeaks.mockReset();
  });

  afterEach(() => {
    __resetRowPeaksForTests();
  });

  it("never runs more than six getPeaks at once", async () => {
    const pending = new Map<number, ReturnType<typeof deferred>>();
    getPeaks.mockImplementation((id: number) => {
      const d = deferred();
      pending.set(id, d);
      return d.promise;
    });
    requestVisible([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getPeaks).toHaveBeenCalledTimes(6);
    expect(peaksQueueSnapshot().queued).toBe(2);
    pending.get(1)?.resolve(peaks(1));
    await flush();
    expect(getPeaks).toHaveBeenCalledTimes(7);
  });

  it("drops queued ids that are no longer visible", async () => {
    const pending: ReturnType<typeof deferred>[] = [];
    getPeaks.mockImplementation(() => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    });
    requestVisible([1, 2, 3, 4, 5, 6, 7, 8]);
    /* Scrolled on: 7 and 8 left the screen before they started. */
    requestVisible([9]);
    for (const d of pending) d.resolve(peaks(0));
    await flush();
    const fetched = getPeaks.mock.calls.map(([id]) => id as number);
    expect(fetched).toEqual([1, 2, 3, 4, 5, 6, 9]);
  });

  it("notifies subscribers of that id only", async () => {
    getPeaks.mockImplementation((id: number) => Promise.resolve(peaks(id)));
    const one = vi.fn();
    const two = vi.fn();
    subscribeRowPeaks(1, one);
    subscribeRowPeaks(2, two);
    requestVisible([1]);
    await flush();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).not.toHaveBeenCalled();
    expect(getRowPeaks(1)?.duration_ms).toBe(1);
  });

  it("does not refetch cached ids", async () => {
    getPeaks.mockImplementation((id: number) => Promise.resolve(peaks(id)));
    requestVisible([1]);
    await flush();
    requestVisible([1]);
    await flush();
    expect(getPeaks).toHaveBeenCalledTimes(1);
  });

  it("keeps showing invalidated peaks and refetches them when visible", async () => {
    getPeaks.mockImplementation((id: number) => Promise.resolve(peaks(id)));
    requestVisible([5]);
    await flush();
    invalidateRowPeaks([5]);
    expect(getRowPeaks(5)).toBeDefined();
    requestVisible([5]);
    await flush();
    expect(getPeaks).toHaveBeenCalledTimes(2);
  });
});
