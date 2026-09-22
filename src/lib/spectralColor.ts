/**
 * Spectral waveform colors: peakfile stores Classic moodbar weights
 * (R = bass, G = mid, B = treble). Themes supply the three band hues;
 * we blend them additively so bass+treble reads purple, etc.
 */

export type Rgb = readonly [number, number, number];

export interface SpectralBandColors {
  bass: Rgb;
  mid: Rgb;
  treble: Rgb;
}

/** Parse `rgb()`, `rgba()`, or `#rrggbb` / `#rgb` from a CSS computed value. */
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

  const rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(trimmed);
  if (rgb) {
    return [
      Math.round(Number(rgb[1])),
      Math.round(Number(rgb[2])),
      Math.round(Number(rgb[3])),
    ];
  }
  return null;
}

/** Read theme band hues from an element's computed style. */
export function readSpectralBands(el: Element): SpectralBandColors {
  const styles = getComputedStyle(el);
  const fallback: SpectralBandColors = {
    bass: [240, 96, 140],
    mid: [110, 210, 150],
    treble: [130, 180, 255],
  };
  return {
    bass: parseCssColor(styles.getPropertyValue("--color-wave-bass")) ?? fallback.bass,
    mid: parseCssColor(styles.getPropertyValue("--color-wave-mid")) ?? fallback.mid,
    treble: parseCssColor(styles.getPropertyValue("--color-wave-treble")) ?? fallback.treble,
  };
}

/**
 * Blend Classic weights with theme band colors. Soft floor keeps quiet
 * spectral energy visible on dark chrome.
 */
export function blendSpectralRgb(
  weights: Rgb,
  bands: SpectralBandColors,
): Rgb {
  const wb = weights[0] / 255;
  const wm = weights[1] / 255;
  const wt = weights[2] / 255;
  let r = wb * bands.bass[0] + wm * bands.mid[0] + wt * bands.treble[0];
  let g = wb * bands.bass[1] + wm * bands.mid[1] + wt * bands.treble[1];
  let b = wb * bands.bass[2] + wm * bands.mid[2] + wt * bands.treble[2];

  const peak = Math.max(r, g, b);
  if (peak > 0.5 && peak < 90) {
    const lift = 90 / peak;
    r *= lift;
    g *= lift;
    b *= lift;
  }

  return [
    Math.min(255, Math.round(r)),
    Math.min(255, Math.round(g)),
    Math.min(255, Math.round(b)),
  ];
}

export function spectralCss(weights: Rgb, bands: SpectralBandColors): string {
  const [r, g, b] = blendSpectralRgb(weights, bands);
  return `rgb(${String(r)},${String(g)},${String(b)})`;
}

/** Bucket `i` weights from the flat peakfile color buffer. */
export function bucketWeights(colors: readonly number[], i: number): Rgb {
  const ci = i * 3;
  return [colors[ci] ?? 0, colors[ci + 1] ?? 0, colors[ci + 2] ?? 0];
}
