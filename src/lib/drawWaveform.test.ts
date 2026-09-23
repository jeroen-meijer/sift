import { describe, expect, it } from "vitest";
import { paintWaveLane, syncCanvasSize } from "./drawWaveform";
import type { SpectralBandColors } from "./spectralColor";

const bands: SpectralBandColors = {
  bass: [255, 0, 0],
  lowMid: [0, 255, 0],
  highMid: [0, 200, 200],
  treble: [0, 0, 255],
};

function fakePeaks(buckets: number): {
  peaks: number[];
  colors: number[];
  bucketCount: number;
  channels: number;
} {
  const peaks: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const t = i / Math.max(1, buckets - 1);
    peaks.push(-0.4 - 0.2 * t, 0.4 + 0.2 * t);
    colors.push(
      Math.round((1 - t) * 255),
      80,
      Math.round(t * 120),
      Math.round(t * 255),
    );
  }
  return { peaks, colors, bucketCount: buckets, channels: 1 };
}

const canvasOk =
  typeof document !== "undefined" &&
  document.createElement("canvas").getContext("2d") != null;

describe.runIf(canvasOk)("drawWaveform", () => {
  it("syncCanvasSize only reallocates when size changes", () => {
    const canvas = document.createElement("canvas");
    const ctx1 = syncCanvasSize(canvas, 100, 20, 2);
    expect(ctx1).not.toBeNull();
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(40);
    const wBefore = canvas.width;
    syncCanvasSize(canvas, 100, 20, 2);
    expect(canvas.width).toBe(wBefore);
    syncCanvasSize(canvas, 120, 20, 2);
    expect(canvas.width).toBe(240);
  });

  it("paintWaveLane fills without throwing for colored and ink modes", () => {
    const canvas = document.createElement("canvas");
    const ctx = syncCanvasSize(canvas, 160, 24, 1);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    const lane = fakePeaks(64);
    paintWaveLane(ctx, lane, {
      width: 160,
      midY: 12,
      ampScale: 10,
      channelIndex: 0,
      colored: true,
      bands,
      ink: "#888",
      style: "gradient",
      maxColorStops: 16,
    });
    paintWaveLane(ctx, lane, {
      width: 160,
      midY: 12,
      ampScale: 10,
      channelIndex: 0,
      colored: true,
      bands,
      ink: "#888",
      style: "columns",
    });
    paintWaveLane(ctx, lane, {
      width: 160,
      midY: 12,
      ampScale: 10,
      channelIndex: 0,
      colored: false,
      bands,
      ink: "#888",
      style: "columns",
    });
  });
});

describe.skipIf(canvasOk)("drawWaveform (no canvas in jsdom)", () => {
  it("documents that paint benches need a real canvas", () => {
    expect(canvasOk).toBe(false);
  });
});
