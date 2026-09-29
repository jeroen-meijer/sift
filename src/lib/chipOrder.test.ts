import { describe, expect, it } from "vitest";
import { EMPTY_OMNI } from "./omni";
import { chipKindsPresent, syncChipOrder } from "./chipOrder";

describe("chipKindsPresent", () => {
  it("includes pending chips that have no value yet", () => {
    expect([...chipKindsPresent(EMPTY_OMNI, "tag")]).toEqual(["tag"]);
  });
});

describe("syncChipOrder", () => {
  it("appends a newly present chip at the end", () => {
    expect(syncChipOrder(["bpm", "key"], new Set(["bpm", "key", "tag"]))).toEqual([
      "bpm",
      "key",
      "tag",
    ]);
  });

  it("drops chips that are no longer present", () => {
    expect(syncChipOrder(["folder", "bpm", "key"], new Set(["bpm"]))).toEqual(["bpm"]);
  });

  it("appends simultaneous new chips in appendOrder", () => {
    expect(
      syncChipOrder([], new Set(["tag", "bpm", "key"]), ["bpm", "key", "tag"]),
    ).toEqual(["bpm", "key", "tag"]);
  });

  it("does not reorder chips that already exist", () => {
    expect(
      syncChipOrder(["key", "bpm"], new Set(["tag", "bpm", "key"]), ["tag", "bpm", "key"]),
    ).toEqual(["key", "bpm", "tag"]);
  });
});
