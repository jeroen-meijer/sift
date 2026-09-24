import { describe, expect, it } from "vitest";
import {
  themeBands,
  themeClassicStrip,
  writeThemedPpm,
} from "./spectralThemeRender";

/** Mid-heavy drum-break weights (amen-shaped), no on-disk ppm. */
function amenLikeWeights(n = 128): number[] {
  const colors: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const midPulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 6);
    const trebleBurst = t % 0.18 < 0.04 ? 180 : 40 + 50 * Math.sin(t * Math.PI * 14);
    const bass = 12 + 8 * Math.sin(t * Math.PI * 2);
    const lowMid = Math.round(70 + 100 * midPulse);
    const highMid = Math.round(30 + 40 * midPulse);
    const treble = Math.round(Math.min(220, Math.max(20, trebleBurst)));
    colors.push(bass, lowMid, highMid, treble);
  }
  return colors;
}

describe("nocturne themed spectral strips", () => {
  it("renders amen with mid+treble variety (not flat violet ink)", () => {
    const colors = amenLikeWeights();
    const bands = themeBands("nocturne");
    const strip = themeClassicStrip(colors, bands);
    writeThemedPpm("amen-nocturne-themed.ppm", strip.pixels);

    expect(strip.midLed).toBeGreaterThan(strip.width * 0.3);
    expect(strip.trebleLed).toBeGreaterThan(strip.width * 0.08);
    expect(strip.meanAdjacentDelta).toBeGreaterThan(8);

    const inkLike = strip.pixels.filter(([r, g, b]) => {
      return Math.abs(r - 123) < 25 && Math.abs(g - 113) < 25 && Math.abs(b - 184) < 30;
    }).length;
    expect(inkLike).toBeLessThan(strip.width * 0.2);
  });

  it("keeps neuro-style overlapping weights colorful under Nocturne", () => {
    const colors: number[] = [];
    const n = 64;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let bass: number;
      let lowMid: number;
      let highMid: number;
      let treble: number;
      if (t < 0.35) {
        bass = 200;
        lowMid = 30;
        highMid = 20;
        treble = 160;
      } else if (t < 0.7) {
        bass = 30;
        lowMid = 180;
        highMid = 60;
        treble = 40;
      } else {
        bass = 20;
        lowMid = 40;
        highMid = 50;
        treble = 210;
      }
      colors.push(bass, lowMid, highMid, treble);
    }
    const strip = themeClassicStrip(colors, themeBands("nocturne"));
    writeThemedPpm("neuro-nocturne-themed.ppm", strip.pixels);

    expect(strip.bassLed + strip.midLed + strip.trebleLed).toBeGreaterThan(n * 0.75);
    expect(strip.bassLed).toBeGreaterThan(5);
    expect(strip.midLed).toBeGreaterThan(5);
    expect(strip.trebleLed).toBeGreaterThan(5);
    expect(strip.meanAdjacentDelta).toBeGreaterThan(5);
  });
});
