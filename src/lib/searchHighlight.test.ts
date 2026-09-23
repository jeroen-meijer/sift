import { describe, expect, it } from "vitest";
import { highlightRanges, searchTokens } from "./searchHighlight";

describe("search highlight", () => {
  it("splits on spaces and name separators", () => {
    expect(searchTokens(" cw  amen_chop-x.y ")).toEqual(["cw", "amen", "chop", "x", "y"]);
  });

  it("marks every word, in any order, case-insensitively", () => {
    expect(highlightRanges("cw_amen_chopper", "AMEN cw")).toEqual([
      [0, 2],
      [3, 7],
    ]);
  });

  it("merges overlapping hits", () => {
    expect(highlightRanges("amen", "am men")).toEqual([[0, 4]]);
  });

  it("returns nothing for a blank query", () => {
    expect(highlightRanges("amen", "   ")).toEqual([]);
  });
});
