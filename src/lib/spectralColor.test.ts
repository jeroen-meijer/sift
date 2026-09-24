import { describe, expect, it } from "vitest";
import {
  blendSpectralRgb,
  parseCssColor,
  spectralCss,
  type SpectralBandColors,
} from "./spectralColor";

const bands: SpectralBandColors = {
  bass: [255, 0, 0],
  lowMid: [0, 255, 0],
  highMid: [0, 200, 200],
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

  it("maps pure band channels onto theme band hues", () => {
    expect(blendSpectralRgb([255, 0, 0, 0], bands)).toEqual([255, 0, 0]);
    expect(blendSpectralRgb([0, 255, 0, 0], bands)).toEqual([0, 255, 0]);
    expect(blendSpectralRgb([0, 0, 0, 255], bands)).toEqual([0, 0, 255]);
    const highMid = blendSpectralRgb([0, 0, 255, 0], bands);
    expect(highMid[1]).toBeGreaterThan(180);
    expect(highMid[2]).toBeGreaterThan(180);
    expect(highMid[0]).toBeLessThan(40);
  });

  it("keeps bass-heavy frames on the bass hue (not white)", () => {
    const mixed = blendSpectralRgb([220, 40, 30, 10], bands);
    expect(mixed[0]).toBeGreaterThan(180);
    expect(mixed[1]).toBeLessThan(60);
    expect(mixed[2]).toBeLessThan(60);
  });

  it("paints low-mid-led frames at full chroma even when energy is moderate", () => {
    const mixed = blendSpectralRgb([20, 140, 40, 10], bands);
    expect(mixed[1]).toBeGreaterThan(200);
    expect(mixed[0]).toBeLessThan(80);
    expect(mixed[2]).toBeLessThan(80);
  });

  it("keeps low-mid vs treble races on the winner hue (not cyan wash)", () => {
    const nocturne: SpectralBandColors = {
      bass: [255, 61, 138],
      lowMid: [46, 232, 154],
      highMid: [64, 200, 230],
      treble: [139, 124, 255],
    };
    const midLed = blendSpectralRgb([10, 180, 40, 20], nocturne);
    expect(midLed[1]).toBeGreaterThan(midLed[2] + 20);
    expect(midLed[1]).toBeGreaterThan(160);
    const trebleLed = blendSpectralRgb([10, 30, 40, 180], nocturne);
    expect(trebleLed[2]).toBeGreaterThan(trebleLed[1] + 20);
  });

  it("pulls a slight low-mid lean hard toward that band (winner-take-more)", () => {
    const nocturne: SpectralBandColors = {
      bass: [255, 61, 138],
      lowMid: [46, 232, 154],
      highMid: [64, 200, 230],
      treble: [139, 124, 255],
    };
    const softLean = blendSpectralRgb([40, 120, 50, 40], nocturne);
    expect(softLean[1]).toBeGreaterThan(softLean[0]);
    expect(softLean[1]).toBeGreaterThan(softLean[2]);
  });

  it("does not paint equal band energy as pure white", () => {
    const mixed = blendSpectralRgb([255, 255, 255, 255], bands);
    const max = Math.max(...mixed);
    expect(max).toBeLessThan(220);
  });

  it("mixes bass and treble into purple", () => {
    const mixed = blendSpectralRgb([200, 0, 0, 200], bands);
    expect(mixed[0]).toBeGreaterThan(100);
    expect(mixed[2]).toBeGreaterThan(100);
    expect(mixed[1]).toBeLessThan(80);
  });

  it("saturates mixed frames away from grey", () => {
    const mutedBands: SpectralBandColors = {
      bass: [180, 100, 120],
      lowMid: [100, 180, 120],
      highMid: [100, 160, 160],
      treble: [100, 120, 180],
    };
    const mixed = blendSpectralRgb([200, 80, 40, 20], mutedBands);
    const max = Math.max(...mixed);
    const min = Math.min(...mixed);
    expect(max - min).toBeGreaterThan(20);
  });

  it("formats a css rgb()", () => {
    expect(spectralCss([255, 0, 0, 0], bands)).toBe("rgb(255,0,0)");
  });
});
