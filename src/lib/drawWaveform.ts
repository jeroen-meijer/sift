import {
  blendSpectralRgb,
  bucketWeights,
  type SpectralBandColors,
} from "./spectralColor";

export interface WaveLanePeaks {
  peaks: readonly number[];
  colors: readonly number[];
  bucketCount: number;
  channels: number;
}

/**
 * Filled min/max envelope for one lane. Colored mode uses a horizontal
 * gradient with a capped stop count (not one stroke per bucket).
 */
export function paintWaveLane(
  ctx: CanvasRenderingContext2D,
  lane: WaveLanePeaks,
  opts: {
    width: number;
    midY: number;
    ampScale: number;
    channelIndex: number;
    colored: boolean;
    bands: SpectralBandColors;
    ink: string;
    /** Max gradient stops; keeps theme-lerp paints cheap. */
    maxColorStops?: number;
  },
): void {
  const { width, midY, ampScale, channelIndex, colored, bands, ink } = opts;
  const maxStops = opts.maxColorStops ?? 48;
  const { peaks, colors, bucketCount, channels } = lane;
  if (bucketCount <= 0 || width <= 0) return;

  const last = Math.max(1, bucketCount - 1);
  const ch = Math.max(1, channels);
  const hasColors = colored && colors.length >= bucketCount * 3;

  ctx.beginPath();
  for (let i = 0; i < bucketCount; i++) {
    const base = i * ch * 2 + channelIndex * 2;
    const max = peaks[base + 1] ?? 0;
    const x = (i / last) * width;
    const y = midY - max * ampScale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = bucketCount - 1; i >= 0; i--) {
    const base = i * ch * 2 + channelIndex * 2;
    const min = peaks[base] ?? 0;
    const x = (i / last) * width;
    ctx.lineTo(x, midY - min * ampScale);
  }
  ctx.closePath();

  if (hasColors) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    const stops = Math.min(bucketCount, maxStops);
    const stopLast = Math.max(1, stops - 1);
    for (let s = 0; s < stops; s++) {
      const i = stops === 1 ? 0 : Math.round((s / stopLast) * last);
      const [r, g, b] = blendSpectralRgb(bucketWeights(colors, i), bands);
      gradient.addColorStop(s / stopLast, `rgb(${String(r)} ${String(g)} ${String(b)})`);
    }
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = ink;
  }
  ctx.fill();
}

/** Resize backing store only when the CSS pixel size or DPR changed. */
export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
