import { describe, expect, it } from "vitest";
import { bpmMatchBadge, keyMatchIsRelativeOnly } from "./omniMatch";

describe("bpmMatchBadge", () => {
  it("is null when direct or toggle off", () => {
    expect(bpmMatchBadge(90, 88, 92, true)).toBeNull();
    expect(bpmMatchBadge(180, 88, 92, false)).toBeNull();
  });

  it("marks half and double hits", () => {
    expect(bpmMatchBadge(45, 88, 92, true)).toBe("÷2");
    expect(bpmMatchBadge(180, 88, 92, true)).toBe("×2");
  });
});

describe("keyMatchIsRelativeOnly", () => {
  it("is true only for relative hits", () => {
    const amin = { pitchClass: 9, mode: "min" as const };
    expect(keyMatchIsRelativeOnly("Am", amin, true)).toBe(false);
    expect(keyMatchIsRelativeOnly("C", amin, true)).toBe(true);
    expect(keyMatchIsRelativeOnly("C", amin, false)).toBe(false);
  });
});
