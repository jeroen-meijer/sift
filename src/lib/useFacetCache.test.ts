import { describe, expect, it } from "vitest";
import { EMPTY_OMNI } from "./omni";
import { facetKindsToWarm } from "./useFacetCache";

describe("facetKindsToWarm", () => {
  it("includes the open editor even without a chip", () => {
    expect(facetKindsToWarm(EMPTY_OMNI, "bpm")).toEqual(["bpm"]);
  });

  it("warms every chip kind present in the query", () => {
    const omni = {
      ...EMPTY_OMNI,
      bpmMin: 120,
      bpmMax: 124,
      key: { pitchClass: 0, mode: "min" as const },
      tagsInclude: ["drums"],
    };
    expect(facetKindsToWarm(omni, null).sort()).toEqual(["bpm", "key", "tag"]);
  });

  it("warms the open editor plus other chips", () => {
    const omni = {
      ...EMPTY_OMNI,
      key: { pitchClass: 9, mode: "maj" as const },
    };
    expect(facetKindsToWarm(omni, "bpm").sort()).toEqual(["bpm", "key"]);
  });

  it("ignores the type editor", () => {
    expect(facetKindsToWarm(EMPTY_OMNI, "type")).toEqual([]);
  });
});
