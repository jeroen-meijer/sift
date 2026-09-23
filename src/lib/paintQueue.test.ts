import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPaintQueueForTests, cancelPaint, paintNow, schedulePaint } from "./paintQueue";

let frames: FrameRequestCallback[] = [];
let now = 0;

function runFrame(): void {
  const current = frames;
  frames = [];
  for (const cb of current) cb(now);
}

describe("paintQueue", () => {
  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    __resetPaintQueueForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs only the latest paint per canvas", () => {
    const canvas = document.createElement("canvas");
    const first = vi.fn();
    const second = vi.fn();
    schedulePaint(canvas, first);
    schedulePaint(canvas, second);
    runFrame();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("spills paints past the frame budget into the next frame", () => {
    const paints = Array.from({ length: 3 }, () =>
      vi.fn(() => {
        now += 5;
      }),
    );
    for (const paint of paints) schedulePaint(document.createElement("canvas"), paint);
    runFrame();
    /* 5 ms, then 10 ms > 6 ms budget: the third waits. */
    expect(paints[2]).not.toHaveBeenCalled();
    runFrame();
    expect(paints[2]).toHaveBeenCalledTimes(1);
  });

  it("drops a cancelled paint", () => {
    const canvas = document.createElement("canvas");
    const paint = vi.fn();
    schedulePaint(canvas, paint);
    cancelPaint(canvas);
    runFrame();
    expect(paint).not.toHaveBeenCalled();
  });

  it("paints immediately until the frame budget is spent, then queues", () => {
    now = 1000;
    const cost = () => {
      now += 4;
    };
    const painted = Array.from({ length: 4 }, () =>
      paintNow(document.createElement("canvas"), cost),
    );
    /* 4 + 4 + 4 ms: the third crosses 10 ms, so the fourth waits. */
    expect(painted).toEqual([true, true, true, false]);
    const late = vi.fn();
    paintNow(document.createElement("canvas"), late);
    expect(late).not.toHaveBeenCalled();
    runFrame();
    expect(late).toHaveBeenCalledTimes(1);
  });
});
