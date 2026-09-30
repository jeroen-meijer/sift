import { describe, expect, it } from "vitest";

/** Same generation gate used by LibraryView list / peaks apply paths. */
function shouldApply(responseGen: number, latestGen: number): boolean {
  return responseGen === latestGen;
}

describe("request generation", () => {
  it("ignores an older list response after a newer one started", () => {
    let latest = 0;
    const first = ++latest;
    const second = ++latest;
    expect(shouldApply(first, latest)).toBe(false);
    expect(shouldApply(second, latest)).toBe(true);
  });

  it("ignores peaks for a superseded focus", () => {
    let peaksGen = 0;
    const forA = ++peaksGen;
    const forB = ++peaksGen;
    expect(shouldApply(forA, peaksGen)).toBe(false);
    expect(shouldApply(forB, peaksGen)).toBe(true);
  });
});

describe("listen cleanup", () => {
  it("unlistens immediately when listen resolves after cancel", async () => {
    const unlistens: string[] = [];
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const trackListen = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => {
        if (cancelled) unlisten();
        else unlisteners.push(unlisten);
      });
    };

    let resolveListen!: (fn: () => void) => void;
    const late = new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    });
    trackListen(late);
    cancelled = true;
    for (const off of unlisteners) off();
    resolveListen(() => {
      unlistens.push("late");
    });
    await late;
    await Promise.resolve();
    expect(unlistens).toEqual(["late"]);
    expect(unlisteners).toHaveLength(0);
  });
});
