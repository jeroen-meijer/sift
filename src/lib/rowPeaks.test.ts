import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPeaks = vi.fn();

vi.mock("./ipc", () => ({
  ipc: {
    getPeaks: (id: number) => getPeaks(id) as Promise<unknown>,
  },
}));

import {
  __resetRowPeaksForTests,
  loadRowPeaks,
  prefetchRowPeaks,
} from "./rowPeaks";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("rowPeaks concurrency", () => {
  beforeEach(() => {
    __resetRowPeaksForTests();
    getPeaks.mockReset();
  });

  afterEach(() => {
    __resetRowPeaksForTests();
  });

  it("never runs more than two getPeaks at once", async () => {
    const gates = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
    getPeaks.mockImplementation((id: number) => {
      const gate = gates[id - 1];
      if (!gate) return Promise.resolve({ id });
      return gate.promise.then(() => ({ id }));
    });

    const p1 = loadRowPeaks(1);
    const p2 = loadRowPeaks(2);
    const p3 = loadRowPeaks(3);
    await flush();
    expect(getPeaks).toHaveBeenCalledTimes(2);

    gates[0]?.resolve({});
    await p1;
    await flush();
    expect(getPeaks).toHaveBeenCalledTimes(3);

    gates[1]?.resolve({});
    gates[2]?.resolve({});
    await Promise.all([p2, p3]);
  });

  it("skips getPeaks for non-local availability", async () => {
    const result = await loadRowPeaks(99, "cloud");
    expect(result).toBeNull();
    expect(getPeaks).not.toHaveBeenCalled();
  });

  it("prefetch skips cloud ids when availability map is set", async () => {
    getPeaks.mockResolvedValue({ id: 1 });
    const avail = new Map<number, string>([
      [1, "local"],
      [2, "cloud"],
      [3, "missing"],
    ]);
    prefetchRowPeaks([1, 2, 3], { availabilityById: avail });
    await flush();
    expect(getPeaks).toHaveBeenCalledTimes(1);
    expect(getPeaks).toHaveBeenCalledWith(1);
  });

  it("keeps a third request queued until a slot frees", async () => {
    const gates = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
    getPeaks.mockImplementation((id: number) => {
      const gate = gates[id - 1];
      if (!gate) return Promise.resolve({ id });
      return gate.promise.then(() => ({ id }));
    });

    prefetchRowPeaks([1, 2, 3]);
    await flush();
    expect(getPeaks.mock.calls.map((c: unknown[]) => c[0] as number).sort()).toEqual([
      1, 2,
    ]);

    gates[0]?.resolve({});
    await flush();
    expect(getPeaks).toHaveBeenCalledTimes(3);
    expect(getPeaks.mock.calls.map((c: unknown[]) => c[0] as number)).toContain(3);

    gates[1]?.resolve({});
    gates[2]?.resolve({});
    await flush();
  });
});
