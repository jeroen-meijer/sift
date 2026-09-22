import {
  blendSpectralRgb,
  bucketWeights,
  type Rgb,
  type SpectralBandColors,
} from "./spectralColor";

export interface WaveLanePeaks {
  peaks: readonly number[];
  colors: readonly number[];
  bucketCount: number;
  channels: number;
}

export type WavePaintStyle = "gradient" | "columns";

function sampleBucket(
  lane: WaveLanePeaks,
  channelIndex: number,
  pos: number,
): { min: number; max: number; weights: Rgb } {
  const last = Math.max(1, lane.bucketCount - 1);
  const ch = Math.max(1, lane.channels);
  const clamped = Math.min(last, Math.max(0, pos));
  const i0 = Math.floor(clamped);
  const i1 = Math.min(last, i0 + 1);
  const f = clamped - i0;
  const base0 = i0 * ch * 2 + channelIndex * 2;
  const base1 = i1 * ch * 2 + channelIndex * 2;
  const min0 = lane.peaks[base0] ?? 0;
  const max0 = lane.peaks[base0 + 1] ?? 0;
  const min1 = lane.peaks[base1] ?? 0;
  const max1 = lane.peaks[base1 + 1] ?? 0;
  const w0 = bucketWeights(lane.colors, i0);
  const w1 = bucketWeights(lane.colors, i1);
  return {
    min: min0 + (min1 - min0) * f,
    max: max0 + (max1 - max0) * f,
    weights: [
      Math.round(w0[0] + (w1[0] - w0[0]) * f),
      Math.round(w0[1] + (w1[1] - w0[1]) * f),
      Math.round(w0[2] + (w1[2] - w0[2]) * f),
    ],
  };
}

/**
 * Draw one waveform lane.
 * - `gradient`: one filled envelope + capped spectral gradient (cheap; rows).
 * - `columns`: one CSS-pixel column at a time with lerped amp/color (matches
 *   how spectral content actually reads on detail waves).
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
    style?: WavePaintStyle;
    /** Max gradient stops when style is `gradient`. */
    maxColorStops?: number;
  },
): void {
  const style = opts.style ?? "gradient";
  if (style === "columns") {
    paintColumns(ctx, lane, opts);
    return;
  }
  paintGradientEnvelope(ctx, lane, opts);
}

function paintGradientEnvelope(
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

function paintColumns(
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
  },
): void {
  const { width, midY, ampScale, channelIndex, colored, bands, ink } = opts;
  const { bucketCount, colors } = lane;
  if (bucketCount <= 0 || width <= 0) return;

  const last = Math.max(1, bucketCount - 1);
  const cols = Math.max(1, Math.ceil(width));
  const hasColors = colored && colors.length >= bucketCount * 3;
  const colLast = Math.max(1, cols - 1);

  for (let c = 0; c < cols; c++) {
    const pos = (c / colLast) * last;
    const sample = sampleBucket(lane, channelIndex, pos);
    const top = midY - sample.max * ampScale;
    const bot = midY - sample.min * ampScale;
    const h = Math.max(1, bot - top);
    if (hasColors) {
      const [r, g, b] = blendSpectralRgb(sample.weights, bands);
      ctx.fillStyle = `rgb(${String(r)} ${String(g)} ${String(b)})`;
    } else {
      ctx.fillStyle = ink;
    }
    ctx.fillRect(c, top, 1, h);
  }
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
