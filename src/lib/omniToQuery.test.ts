import { describe, expect, it } from "vitest";
import { EMPTY_OMNI } from "./omni";
import { omniToSampleQuery } from "./omniToQuery";

const baseOpts = {
  favoritesOnly: false,
  halfDouble: false,
  relativeKey: false,
  sortColumn: "name" as const,
  sortDirection: "asc" as const,
  limit: 100,
};

describe("omniToSampleQuery", () => {
  it("maps bpm, tags, type, and either-key", () => {
    const q = omniToSampleQuery(
      {
        ...EMPTY_OMNI,
        text: "kick",
        bpmMin: 88,
        bpmMax: 92,
        key: { pitchClass: 9, mode: "either" },
        tagsInclude: ["drums/kick"],
        tagsExclude: ["vocals"],
        sampleType: "loop",
      },
      { ...baseOpts, halfDouble: true, relativeKey: true },
    );
    expect(q.text).toBe("kick");
    expect(q.bpm_min).toBe(88);
    expect(q.bpm_max).toBe(92);
    expect(q.half_double).toBe(true);
    expect(q.key).toBe("A");
    expect(q.key_either).toBe(true);
    // Relative is off when mode is either.
    expect(q.relative_key).toBe(false);
    expect(q.tag_paths).toEqual(["drums/kick"]);
    expect(q.tag_exclude_paths).toEqual(["vocals"]);
    expect(q.sample_type).toBe("loop");
  });

  it("maps keyed mode with relative flag", () => {
    const q = omniToSampleQuery(
      {
        ...EMPTY_OMNI,
        key: { pitchClass: 9, mode: "min" },
      },
      { ...baseOpts, relativeKey: true },
    );
    expect(q.key).toBe("Am");
    expect(q.key_either).toBe(false);
    expect(q.relative_key).toBe(true);
  });

  it("omits a dimension for facet counts", () => {
    const state = {
      ...EMPTY_OMNI,
      bpmMin: 90,
      bpmMax: 90,
      key: { pitchClass: 0, mode: "maj" as const },
      sampleType: "loop" as const,
    };
    expect(omniToSampleQuery(state, { ...baseOpts, omit: "bpm" }).bpm_min).toBeNull();
    expect(omniToSampleQuery(state, { ...baseOpts, omit: "key" }).key).toBeNull();
    expect(omniToSampleQuery(state, { ...baseOpts, omit: "type" }).sample_type).toBeNull();
  });
});
