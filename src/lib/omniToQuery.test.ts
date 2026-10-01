import { describe, expect, it } from "vitest";
import { EMPTY_OMNI } from "./omni";
import { facetListCacheKey, omniToSampleQuery } from "./omniToQuery";

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

describe("facetListCacheKey", () => {
  it("stays stable when omitted BPM range changes", () => {
    const a = omniToSampleQuery(
      { ...EMPTY_OMNI, bpmMin: 168, bpmMax: 172, tagsInclude: ["drums"] },
      { ...baseOpts, omit: "bpm" },
    );
    const b = omniToSampleQuery(
      { ...EMPTY_OMNI, bpmMin: 80, bpmMax: 90, tagsInclude: ["drums"] },
      { ...baseOpts, omit: "bpm" },
    );
    expect(facetListCacheKey(a, 1)).toBe(facetListCacheKey(b, 1));
  });

  it("changes when other filters or library epoch change", () => {
    const base = omniToSampleQuery(
      { ...EMPTY_OMNI, tagsInclude: ["drums"] },
      { ...baseOpts, omit: "bpm" },
    );
    const otherTags = omniToSampleQuery(
      { ...EMPTY_OMNI, tagsInclude: ["vocals"] },
      { ...baseOpts, omit: "bpm" },
    );
    expect(facetListCacheKey(base, 1)).not.toBe(facetListCacheKey(otherTags, 1));
    expect(facetListCacheKey(base, 1)).not.toBe(facetListCacheKey(base, 2));
  });

  it("ignores sort column and direction", () => {
    const byName = omniToSampleQuery(EMPTY_OMNI, { ...baseOpts, omit: "bpm" });
    const byBpm = omniToSampleQuery(EMPTY_OMNI, {
      ...baseOpts,
      omit: "bpm",
      sortColumn: "bpm",
      sortDirection: "desc",
    });
    expect(facetListCacheKey(byName, 0)).toBe(facetListCacheKey(byBpm, 0));
  });
});
