/**
 * Spectral waveform colors: peakfile stores four band weights
 * (bass, low-mid, high-mid, treble). Themes supply the band hues; we blend
 * them additively so bass+treble reads purple, etc.
 */

export type Rgb = readonly [number, number, number];

/** Per-bucket band weights (0–255), same order as the peakfile. */
export type BandWeights = readonly [number, number, number, number];

export const BAND_COUNT = 4 as const;

export interface SpectralBandColors {
  bass: Rgb;
  lowMid: Rgb;
  highMid: Rgb;
  treble: Rgb;
}

let probeCtx: CanvasRenderingContext2D | null | undefined;

function canvasProbe(): CanvasRenderingContext2D | null {
  if (probeCtx !== undefined) return probeCtx;
  if (typeof document === "undefined") {
    probeCtx = null;
    return null;
  }
  const canvas = document.createElement("canvas");
  probeCtx = canvas.getContext("2d");
  return probeCtx;
}

/**
 * Parse a CSS color string into 0-255 RGB. Handles hex, rgb()/rgba(),
 * space-separated rgb, color(srgb …), and falls back to a canvas probe
 * so @property-interpolated values still resolve.
 */
export function parseCssColor(raw: string): Rgb | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex?.[1]) {
    const h = hex[1];
    if (h.length === 3) {
      const rChar = h.charAt(0);
      const gChar = h.charAt(1);
      const bChar = h.charAt(2);
      return [
        Number.parseInt(rChar + rChar, 16),
        Number.parseInt(gChar + gChar, 16),
        Number.parseInt(bChar + bChar, 16),
      ];
    }
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }

  const rgbComma =
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(trimmed);
  if (rgbComma) {
    return [
      Math.round(Number(rgbComma[1])),
      Math.round(Number(rgbComma[2])),
      Math.round(Number(rgbComma[3])),
    ];
  }

  const rgbSpace =
    /^rgba?\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i.exec(trimmed);
  if (rgbSpace) {
    return [
      Math.round(Number(rgbSpace[1])),
      Math.round(Number(rgbSpace[2])),
      Math.round(Number(rgbSpace[3])),
    ];
  }

  const srgb =
    /^color\(\s*srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i.exec(trimmed);
  if (srgb) {
    return [
      Math.round(Number(srgb[1]) * 255),
      Math.round(Number(srgb[2]) * 255),
      Math.round(Number(srgb[3]) * 255),
    ];
  }

  const probe = canvasProbe();
  if (probe) {
    probe.fillStyle = "#000000";
    probe.fillStyle = trimmed;
    const normalized = probe.fillStyle;
    if (normalized !== trimmed) {
      return parseCssColor(normalized);
    }
    const fromProbe =
      /^#([0-9a-f]{6})$/i.exec(normalized) ??
      /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(normalized);
    if (fromProbe && fromProbe[0].startsWith("#") && fromProbe[1]) {
      const h = fromProbe[1];
      return [
        Number.parseInt(h.slice(0, 2), 16),
        Number.parseInt(h.slice(2, 4), 16),
        Number.parseInt(h.slice(4, 6), 16),
      ];
    }
  }

  return null;
}

/** Read theme band hues from an element's computed style. */
export function readSpectralBands(el: Element): SpectralBandColors {
  return readSpectralBandsFrom(getComputedStyle(el));
}

/** Band hues from an already computed style (no extra style recalc). */
export function readSpectralBandsFrom(styles: CSSStyleDeclaration): SpectralBandColors {
  const fallback: SpectralBandColors = {
    bass: [240, 96, 140],
    lowMid: [110, 210, 150],
    highMid: [64, 200, 230],
    treble: [130, 180, 255],
  };
  /* `--color-wave-mid` is the legacy name for low-mid. */
  const lowMid =
    parseCssColor(styles.getPropertyValue("--color-wave-low-mid")) ??
    parseCssColor(styles.getPropertyValue("--color-wave-mid")) ??
    fallback.lowMid;
  return {
    bass: parseCssColor(styles.getPropertyValue("--color-wave-bass")) ?? fallback.bass,
    lowMid,
    highMid:
      parseCssColor(styles.getPropertyValue("--color-wave-high-mid")) ?? fallback.highMid,
    treble: parseCssColor(styles.getPropertyValue("--color-wave-treble")) ?? fallback.treble,
  };
}

/**
 * Blend band weights with theme band colors.
 *
 * Raise the dominant band share (winner-take-more) so clear leads read as that
 * hue instead of collapsing to a flat mix. Overlaps still blend (not hard
 * argmax). Brightness is not tied to spectral energy (geometry already shows amp).
 */
export function blendSpectralRgb(weights: BandWeights, bands: SpectralBandColors): Rgb {
  const rawB = weights[0] / 255;
  const rawL = weights[1] / 255;
  const rawH = weights[2] / 255;
  const rawT = weights[3] / 255;
  const sum = rawB + rawL + rawH + rawT;
  if (sum < 1e-6) {
    return [0, 0, 0];
  }

  /* Soft mix ≈ 1.5; hard winner ≈ 6+. 3.5 keeps ties blended but swings clear. */
  const emphasis = 3.5;
  let pB = (rawB / sum) ** emphasis;
  let pL = (rawL / sum) ** emphasis;
  let pH = (rawH / sum) ** emphasis;
  let pT = (rawT / sum) ** emphasis;
  const pSum = pB + pL + pH + pT || 1;
  pB /= pSum;
  pL /= pSum;
  pH /= pSum;
  pT /= pSum;

  let r =
    pB * bands.bass[0] +
    pL * bands.lowMid[0] +
    pH * bands.highMid[0] +
    pT * bands.treble[0];
  let g =
    pB * bands.bass[1] +
    pL * bands.lowMid[1] +
    pH * bands.highMid[1] +
    pT * bands.treble[1];
  let b =
    pB * bands.bass[2] +
    pL * bands.lowMid[2] +
    pH * bands.highMid[2] +
    pT * bands.treble[2];

  const avg = (r + g + b) / 3;
  const sat = 1.65;
  r = avg + (r - avg) * sat;
  g = avg + (g - avg) * sat;
  b = avg + (b - avg) * sat;

  return [
    Math.min(255, Math.max(0, Math.round(r))),
    Math.min(255, Math.max(0, Math.round(g))),
    Math.min(255, Math.max(0, Math.round(b))),
  ];
}

export function spectralCss(weights: BandWeights, bands: SpectralBandColors): string {
  const [r, g, b] = blendSpectralRgb(weights, bands);
  return `rgb(${String(r)},${String(g)},${String(b)})`;
}

/** Bucket `i` weights from the flat peakfile color buffer. */
export function bucketWeights(colors: readonly number[], i: number): BandWeights {
  const ci = i * BAND_COUNT;
  return [
    colors[ci] ?? 0,
    colors[ci + 1] ?? 0,
    colors[ci + 2] ?? 0,
    colors[ci + 3] ?? 0,
  ];
}
