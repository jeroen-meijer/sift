import { describe, expect, it } from "vitest";
import { TAG_SWATCHES, tagPalette } from "./tagColors";

describe("tagPalette", () => {
  it("colours a tag from the root segment of its path", () => {
    expect(tagPalette("Drums/Kick/808")).toEqual(tagPalette("Drums"));
    expect(tagPalette("Drums").bg).toBe("#39305a");
  });

  it("falls back to neutral for an unknown root", () => {
    expect(tagPalette("Homemade/Thing").bg).toBe("#31333d");
  });

  it("lets an explicit colour win over the root palette", () => {
    const custom = tagPalette("Drums/Kick", "#5f9a72");
    expect(custom.dot).toBe("#5f9a72");
    expect(custom.bg).not.toBe(tagPalette("Drums").bg);
  });

  it("builds a dark ground and light ink from a custom colour", () => {
    const { bg, fg } = tagPalette("Anything", "#ffffff");
    expect(bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(fg).toMatch(/^#[0-9a-f]{6}$/);
    // The ground stays darker than the ink it carries.
    expect(Number.parseInt(bg.slice(1), 16)).toBeLessThan(Number.parseInt(fg.slice(1), 16));
  });

  it("ignores a colour it cannot parse", () => {
    expect(tagPalette("Drums", "rebeccapurple")).toEqual(tagPalette("Drums"));
  });

  it("offers every root palette dot as a swatch", () => {
    expect(TAG_SWATCHES).toContain("#8a7ad0");
    expect(TAG_SWATCHES).toHaveLength(7);
  });
});
