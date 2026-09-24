import { describe, expect, it } from "vitest";
import { buildThemePreviewLane } from "./themeWavePreviewData";

describe("buildThemePreviewLane", () => {
  it("emits overlapping band weights, not a pure left-to-right rainbow", () => {
    const lane = buildThemePreviewLane();
    expect(lane.bucketCount).toBeGreaterThan(64);
    expect(lane.colors.length).toBe(lane.bucketCount * 4);

    /* ~t=0.3 neuro body: bass + treble high (pink), mids lower. */
    const body = Math.floor(0.3 * (lane.bucketCount - 1));
    const br = lane.colors[body * 4] ?? 0;
    const bg = lane.colors[body * 4 + 1] ?? 0;
    const bb = lane.colors[body * 4 + 3] ?? 0;
    expect(br).toBeGreaterThan(100);
    expect(bb).toBeGreaterThan(80);
    expect(bg).toBeLessThan(br);
  });

  it("has a bright transient then a quieter tail", () => {
    const lane = buildThemePreviewLane();
    const ampAt = (i: number) => Math.abs(lane.peaks[i * 2 + 1] ?? 0);
    const head = ampAt(4);
    const tail = ampAt(lane.bucketCount - 4);
    expect(head).toBeGreaterThan(tail);
  });
});
