import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blendSpectralRgb,
  parseCssColor,
  type Rgb,
  type SpectralBandColors,
} from "./spectralColor";
import { THEME_INFO, type ThemeId } from "../theme/index";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../testdata/spectral-fixtures",
);

/** Nocturne (and friends) band hues used by canvas paint. */
export function themeBands(id: ThemeId): SpectralBandColors {
  const hex = THEME_INFO[id].waveBands;
  const fallback: SpectralBandColors = {
    bass: [255, 61, 138],
    mid: [46, 232, 154],
    treble: [139, 124, 255],
  };
  return {
    bass: parseCssColor(hex.bass) ?? fallback.bass,
    mid: parseCssColor(hex.mid) ?? fallback.mid,
    treble: parseCssColor(hex.treble) ?? fallback.treble,
  };
}

/** Parse a P3 PPM of Classic moodbar weights (bass→R, mid→G, treble→B). */
export function parseClassicPpm(text: string): { width: number; colors: number[] } {
  const tokens = text.trim().split(/\s+/);
  if (tokens[0] !== "P3") throw new Error("expected P3 ppm");
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const max = Number(tokens[3]);
  if (!width || !height || max !== 255) throw new Error("bad ppm header");
  const nums = tokens.slice(4).map(Number);
  /* One row is enough; Classic fixtures repeat the same strip. */
  const colors = nums.slice(0, width * 3);
  if (colors.length < width * 3) throw new Error("short ppm body");
  return { width, colors };
}

export interface ThemedStripStats {
  width: number;
  /** Buckets where mid theme hue clearly wins (greenish). */
  midLed: number;
  /** Buckets where treble theme hue clearly wins (violet). */
  trebleLed: number;
  /** Buckets where bass theme hue clearly wins (pink). */
  bassLed: number;
  /** Mean absolute channel delta between adjacent themed pixels. */
  meanAdjacentDelta: number;
  pixels: Rgb[];
}

/** Theme-map Classic weights and measure diversity. */
export function themeClassicStrip(
  classicColors: number[],
  bands: SpectralBandColors,
): ThemedStripStats {
  const width = Math.floor(classicColors.length / 3);
  const pixels: Rgb[] = [];
  let midLed = 0;
  let trebleLed = 0;
  let bassLed = 0;
  let adj = 0;
  for (let i = 0; i < width; i++) {
    const w: Rgb = [
      classicColors[i * 3] ?? 0,
      classicColors[i * 3 + 1] ?? 0,
      classicColors[i * 3 + 2] ?? 0,
    ];
    const rgb = blendSpectralRgb(w, bands);
    pixels.push(rgb);
    const [r, g, b] = rgb;
    /* Pink (bass+treble) counts as bass-led for neuro-style fixtures. */
    if (r > 140 && b > 100 && g < Math.min(r, b) + 40) bassLed += 1;
    else if (g > b + 15 && g > r + 15) midLed += 1;
    else if (b > g + 10 && b >= r - 20) trebleLed += 1;
    else if (r > g + 20 && r > b + 10) bassLed += 1;
    if (i > 0) {
      const prev = pixels[i - 1] ?? rgb;
      adj +=
        Math.abs(r - prev[0]) + Math.abs(g - prev[1]) + Math.abs(b - prev[2]);
    }
  }
  return {
    width,
    midLed,
    trebleLed,
    bassLed,
    meanAdjacentDelta: width > 1 ? adj / (width - 1) : 0,
    pixels,
  };
}

/** Write a P3 PPM strip (and path) for visual inspection. */
export function writeThemedPpm(
  filename: string,
  pixels: readonly Rgb[],
  height = 32,
): string {
  mkdirSync(FIXTURES, { recursive: true });
  const width = pixels.length;
  const lines = [`P3`, `${String(width)} ${String(height)}`, `255`];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (const [r, g, b] of pixels) {
      row.push(`${String(r)} ${String(g)} ${String(b)}`);
    }
    lines.push(row.join(" "));
  }
  const path = join(FIXTURES, filename);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

export function fixturesDir(): string {
  return FIXTURES;
}
