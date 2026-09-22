import { bench, describe } from "vitest";
import { paintWaveLane, syncCanvasSize } from "./drawWaveform";
import type { SpectralBandColors } from "./spectralColor";

const bands: SpectralBandColors = {
  bass: [255, 45, 123],
  mid: [30, 232, 154],
  treble: [62, 184, 255],
};

function lane(buckets: number, channels = 1) {
  const peaks: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const t = i / Math.max(1, buckets - 1);
    for (let c = 0; c < channels; c++) {
      peaks.push(-0.5, 0.5);
    }
    colors.push(Math.round((1 - t) * 255), 64, Math.round(t * 255));
  }
  return { peaks, colors, bucketCount: buckets, channels };
}

const canvas = document.createElement("canvas");
const ctx = syncCanvasSize(canvas, 800, 120, 1);
const canBench = ctx != null;

describe.runIf(canBench)("paintWaveLane", () => {
  const detail = lane(1024, 2);
  const row = lane(1024, 1);
  const surface = ctx;

  bench("detail stereo colored 1024 buckets / 64 stops", () => {
    if (!surface) return;
    surface.clearRect(0, 0, 800, 120);
    paintWaveLane(surface, detail, {
      width: 800,
      midY: 30,
      ampScale: 28,
      channelIndex: 0,
      colored: true,
      bands,
      ink: "#888",
      maxColorStops: 64,
    });
    paintWaveLane(surface, detail, {
      width: 800,
      midY: 90,
      ampScale: 28,
      channelIndex: 1,
      colored: true,
      bands,
      ink: "#888",
      maxColorStops: 64,
    });
  });

  bench("row mono colored 1024 buckets / 32 stops", () => {
    if (!surface) return;
    surface.clearRect(0, 0, 180, 18);
    paintWaveLane(surface, row, {
      width: 180,
      midY: 9,
      ampScale: 7,
      channelIndex: 0,
      colored: true,
      bands,
      ink: "#888",
      maxColorStops: 32,
    });
  });

  bench("legacy-style 1024 per-bucket strokes (baseline)", () => {
    if (!surface) return;
    surface.clearRect(0, 0, 800, 60);
    const mid = 30;
    const last = 1023;
    for (let i = 0; i < 1024; i++) {
      surface.strokeStyle = `rgb(${String(255 - (i % 255))} 80 ${String(i % 255)})`;
      surface.beginPath();
      const x = (i / last) * 800;
      surface.moveTo(x, mid - 20);
      surface.lineTo(x, mid + 20);
      surface.stroke();
    }
  });
});
