import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fixturesDir,
  parseClassicPpm,
  themeBands,
  themeClassicStrip,
  writeThemedPpm,
} from "./spectralThemeRender";

describe("nocturne themed spectral strips", () => {
  it("renders amen with mid+treble variety (not flat violet ink)", () => {
    const ppm = readFileSync(
      join(fixturesDir(), "amen-classic-weights.ppm"),
      "utf8",
    );
    const { colors } = parseClassicPpm(ppm);
    const bands = themeBands("nocturne");
    const strip = themeClassicStrip(colors, bands);
    writeThemedPpm("amen-nocturne-themed.ppm", strip.pixels);

    /*
     * Classic amen fixture is mid-heavy with treble accents. After Nocturne
     * remap that must read as green stretches + violet accents — never a
     * single purple (that was --color-wave-ink when colors failed to paint).
     */
    expect(strip.midLed).toBeGreaterThan(strip.width * 0.35);
    expect(strip.trebleLed).toBeGreaterThan(strip.width * 0.08);
    expect(strip.meanAdjacentDelta).toBeGreaterThan(8);

    const inkLike = strip.pixels.filter(([r, g, b]) => {
      /* Nocturne wave-ink ≈ #7b71b8 */
      return Math.abs(r - 123) < 25 && Math.abs(g - 113) < 25 && Math.abs(b - 184) < 30;
    }).length;
    expect(inkLike).toBeLessThan(strip.width * 0.2);
  });

  it("keeps neuro-style overlapping weights colorful under Nocturne", () => {
    /* Synthetic neuro body: bass+treble pink, then mid, then treble. */
    const colors: number[] = [];
    const n = 64;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let bass: number;
      let mid: number;
      let treble: number;
      if (t < 0.35) {
        bass = 200;
        mid = 40;
        treble = 160;
      } else if (t < 0.7) {
        bass = 30;
        mid = 200;
        treble = 60;
      } else {
        bass = 20;
        mid = 50;
        treble = 210;
      }
      colors.push(bass, mid, treble);
    }
    const strip = themeClassicStrip(colors, themeBands("nocturne"));
    writeThemedPpm("neuro-nocturne-themed.ppm", strip.pixels);

    expect(strip.bassLed + strip.midLed + strip.trebleLed).toBeGreaterThan(n * 0.8);
    expect(strip.bassLed).toBeGreaterThan(5);
    expect(strip.midLed).toBeGreaterThan(5);
    expect(strip.trebleLed).toBeGreaterThan(5);
    /* Three regions → deltas concentrated at boundaries. */
    expect(strip.meanAdjacentDelta).toBeGreaterThan(5);
  });
});
