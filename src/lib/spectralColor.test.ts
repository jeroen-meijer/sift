import { describe, expect, it } from "vitest";
import {
  blendSpectralRgb,
  parseCssColor,
  spectralCss,
  type SpectralBandColors,
} from "./spectralColor";

const bands: SpectralBandColors = {
  bass: [255, 0, 0],
  mid: [0, 255, 0],
  treble: [0, 0, 255],
};

describe("spectralColor", () => {
  it("parses hex and rgb()", () => {
    expect(parseCssColor("#ff608c")).toEqual([255, 96, 140]);
    expect(parseCssColor("#f0c")).toEqual([255, 0, 204]);
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(parseCssColor("rgb(10 20 30)")).toEqual([10, 20, 30]);
    expect(parseCssColor("color(srgb 1 0.5 0)")).toEqual([255, 128, 0]);
  });

  it("maps pure Classic channels onto theme band hues", () => {
    expect(blendSpectralRgb([255, 0, 0], bands)).toEqual([255, 0, 0]);
    expect(blendSpectralRgb([0, 255, 0], bands)).toEqual([0, 255, 0]);
    expect(blendSpectralRgb([0, 0, 255], bands)).toEqual([0, 0, 255]);
  });

  it("keeps bass-heavy frames on the bass hue (not white)", () => {
    const mixed = blendSpectralRgb([220, 40, 30], bands);
    expect(mixed[0]).toBeGreaterThan(180);
    expect(mixed[1]).toBeLessThan(60);
    expect(mixed[2]).toBeLessThan(60);
  });

  it("does not paint equal band energy as pure white", () => {
    const mixed = blendSpectralRgb([255, 255, 255], bands);
    const max = Math.max(...mixed);
    const min = Math.min(...mixed);
    /* Primary R+G+B mix → greyish, not #fff. */
    expect(max - min).toBeLessThan(40);
    expect(max).toBeLessThan(200);
  });

  it("mixes bass and treble into purple", () => {
    const mixed = blendSpectralRgb([200, 0, 200], bands);
    expect(mixed[0]).toBeGreaterThan(100);
    expect(mixed[2]).toBeGreaterThan(100);
    expect(mixed[1]).toBeLessThan(80);
  });

  it("saturates mixed frames away from grey", () => {
    const mutedBands: SpectralBandColors = {
      bass: [180, 100, 120],
      mid: [100, 180, 120],
      treble: [100, 120, 180],
    };
    const mixed = blendSpectralRgb([200, 80, 40], mutedBands);
    const max = Math.max(...mixed);
    const min = Math.min(...mixed);
    expect(max - min).toBeGreaterThan(20);
  });

  it("formats a css rgb()", () => {
    expect(spectralCss([255, 0, 0], bands)).toBe("rgb(255,0,0)");
  });
});
