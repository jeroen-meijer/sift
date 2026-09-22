import { describe, expect, it } from "vitest";
import { MOTION_CURVES, motionCurve, prefersReducedMotion } from "./motion";

describe("motion", () => {
  it("exposes fastInEaseOut as a four-point cubic-bezier", () => {
    const curve = MOTION_CURVES.fastInEaseOut;
    expect(curve).toHaveLength(4);
    expect(curve[1]).toBeGreaterThan(0.5);
    expect(curve[3]).toBe(1);
  });

  it("motionCurve falls back to the named registry offline", () => {
    expect(motionCurve("ease")).toEqual(MOTION_CURVES.ease);
    expect(motionCurve("fastInEaseOut")).toEqual(MOTION_CURVES.fastInEaseOut);
  });

  it("prefersReducedMotion is a boolean in jsdom", () => {
    expect(typeof prefersReducedMotion()).toBe("boolean");
  });
});
