import { describe, expect, it } from "vitest";
import {
  NOTES,
  camelotLabel,
  camelotToOmniKey,
  formatOmniKey,
  parseOmniKey,
  relativePitchClass,
  serializeOmniKeyBody,
  storedKeyToOmni,
} from "./omniKey";

describe("NOTES", () => {
  it("lists the display spellings", () => {
    expect([...NOTES]).toEqual([
      "C",
      "C#",
      "D",
      "Eb",
      "E",
      "F",
      "F#",
      "G",
      "Ab",
      "A",
      "Bb",
      "B",
    ]);
  });
});

describe("parseOmniKey", () => {
  it("parses roots, modes, and Camelot", () => {
    expect(parseOmniKey("a")).toEqual({ pitchClass: 9, mode: "either" });
    expect(parseOmniKey("f#m")).toEqual({ pitchClass: 6, mode: "min" });
    expect(parseOmniKey("bbmin")).toEqual({ pitchClass: 10, mode: "min" });
    expect(parseOmniKey("amaj")).toEqual({ pitchClass: 9, mode: "maj" });
    expect(parseOmniKey("8a")).toEqual({ pitchClass: 9, mode: "min" });
    expect(parseOmniKey("11b")).toEqual({ pitchClass: 9, mode: "maj" });
  });

  it("returns null for garbage", () => {
    expect(parseOmniKey("")).toBeNull();
    expect(parseOmniKey("xyz")).toBeNull();
  });
});

describe("formatOmniKey", () => {
  it("formats without Camelot (chip space)", () => {
    expect(formatOmniKey({ pitchClass: 9, mode: "maj" })).toBe("A maj");
    expect(formatOmniKey({ pitchClass: 9, mode: "min" })).toBe("A min");
    expect(formatOmniKey({ pitchClass: 9, mode: "either" })).toBe("A");
  });
});

describe("Camelot", () => {
  it("round-trips Camelot numbers for parse", () => {
    for (let n = 1; n <= 12; n++) {
      const min = camelotToOmniKey(n, "a");
      const maj = camelotToOmniKey(n, "b");
      expect(min && camelotLabel(min)).toBe(`${String(n)}A`);
      expect(maj && camelotLabel(maj)).toBe(`${String(n)}B`);
    }
  });
});

describe("serializeOmniKeyBody", () => {
  it("uses NOTES spelling and mode suffixes", () => {
    expect(serializeOmniKeyBody({ pitchClass: 3, mode: "either" })).toBe("eb");
    expect(serializeOmniKeyBody({ pitchClass: 9, mode: "min" })).toBe("am");
    expect(serializeOmniKeyBody({ pitchClass: 9, mode: "maj" })).toBe("amaj");
  });
});

describe("relativePitchClass", () => {
  it("moves ±3", () => {
    expect(relativePitchClass(9, "min")).toBe(0); // A min → C maj
    expect(relativePitchClass(0, "maj")).toBe(9); // C maj → A min
  });
});

describe("storedKeyToOmni", () => {
  it("maps analyzer spellings", () => {
    expect(storedKeyToOmni("Am")).toEqual({ pitchClass: 9, mode: "min" });
    expect(storedKeyToOmni("A")).toEqual({ pitchClass: 9, mode: "maj" });
    expect(storedKeyToOmni("F#")).toEqual({ pitchClass: 6, mode: "maj" });
  });
});
