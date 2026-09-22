import { describe, expect, it } from "vitest";
import {
  filterMusicalKeys,
  keyMatchesStored,
  normalizeKeyToken,
  resolveKeyInput,
} from "./keys";

describe("normalizeKeyToken", () => {
  it("accepts compact and spaced maj/min forms", () => {
    expect(normalizeKeyToken("amaj")).toBe("a");
    expect(normalizeKeyToken("A maj")).toBe("a");
    expect(normalizeKeyToken("amin")).toBe("am");
    expect(normalizeKeyToken("A min")).toBe("am");
    expect(normalizeKeyToken("c major")).toBe("c");
    expect(normalizeKeyToken("Bb minor")).toBe("a#m");
    expect(normalizeKeyToken("F#m")).toBe("f#m");
  });
});

describe("filterMusicalKeys", () => {
  it("ranks maj/min hits from flexible queries", () => {
    expect(filterMusicalKeys("amaj").map((k) => k.label)).toEqual(["A maj"]);
    expect(filterMusicalKeys("amin").map((k) => k.label)).toEqual(["A min"]);
    expect(filterMusicalKeys("cma").map((k) => k.label)).toEqual(["C maj"]);
    expect(filterMusicalKeys("c maj").map((k) => k.label)).toEqual(["C maj"]);
    expect(filterMusicalKeys("bbmin").map((k) => k.value)).toEqual(["A#m"]);
    expect(filterMusicalKeys("c").map((k) => k.value)).toContain("C");
    expect(filterMusicalKeys("c").map((k) => k.value)).toContain("Cm");
  });

  it("returns the full list when empty", () => {
    expect(filterMusicalKeys("").length).toBe(24);
  });
});

describe("resolveKeyInput", () => {
  it("resolves to analyzer-style values", () => {
    expect(resolveKeyInput("amaj")).toBe("A");
    expect(resolveKeyInput("A min")).toBe("Am");
    expect(resolveKeyInput("")).toBeNull();
  });
});

describe("keyMatchesStored", () => {
  it("matches analyzer Am against picker A min", () => {
    expect(keyMatchesStored("Am", { value: "Am", label: "A min" })).toBe(true);
    expect(keyMatchesStored("A", { value: "A", label: "A maj" })).toBe(true);
    expect(keyMatchesStored("Am", { value: "A", label: "A maj" })).toBe(false);
  });
});
