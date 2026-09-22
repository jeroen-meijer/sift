import { describe, expect, it } from "vitest";
import {
  BEAT_PRESETS,
  beatsFromBpm,
  beatsMatchBpm,
  bpmFromBeats,
  sharedBpmFromBeats,
  sharedDuration,
} from "./bpm";

/* A 2-second loop holding 4 beats is 120 BPM. */
const TWO_SECONDS = 2000;

describe("bpmFromBeats", () => {
  it("derives the tempo from the length and the beat count", () => {
    expect(bpmFromBeats(TWO_SECONDS, 4, true)).toBe(120);
    expect(bpmFromBeats(TWO_SECONDS, 8, true)).toBe(240);
    expect(bpmFromBeats(4000, 8, true)).toBe(120);
  });

  it("rounds to a whole number only when asked", () => {
    expect(bpmFromBeats(1379, 4, true)).toBe(174);
    expect(bpmFromBeats(1379, 4, false)).toBeCloseTo(174.04, 2);
  });

  it("gives nothing without a usable length or beat count", () => {
    expect(bpmFromBeats(null, 4, true)).toBeNull();
    expect(bpmFromBeats(0, 4, true)).toBeNull();
    expect(bpmFromBeats(-1, 4, true)).toBeNull();
    expect(bpmFromBeats(TWO_SECONDS, 0, true)).toBeNull();
    expect(bpmFromBeats(TWO_SECONDS, -4, true)).toBeNull();
    expect(bpmFromBeats(TWO_SECONDS, Number.NaN, true)).toBeNull();
  });
});

describe("beatsFromBpm", () => {
  it("is the inverse of bpmFromBeats", () => {
    expect(beatsFromBpm(TWO_SECONDS, 120)).toBeCloseTo(4);
    expect(beatsFromBpm(4000, 120)).toBeCloseTo(8);
  });

  it("gives nothing when either side is missing", () => {
    expect(beatsFromBpm(null, 120)).toBeNull();
    expect(beatsFromBpm(TWO_SECONDS, null)).toBeNull();
    expect(beatsFromBpm(TWO_SECONDS, 0)).toBeNull();
  });
});

describe("beatsMatchBpm", () => {
  it("marks the beat count the stored BPM already implies", () => {
    expect(beatsMatchBpm(TWO_SECONDS, 120, 4)).toBe(true);
    expect(beatsMatchBpm(TWO_SECONDS, 120, 8)).toBe(false);
  });

  it("tolerates a rounded BPM", () => {
    expect(beatsMatchBpm(1379, 174, 4)).toBe(true);
  });

  it("matches nothing when the sample has no BPM", () => {
    expect(beatsMatchBpm(TWO_SECONDS, null, 4)).toBe(false);
  });
});

describe("sharedBpmFromBeats", () => {
  it("gives one number when every sample agrees", () => {
    expect(sharedBpmFromBeats([TWO_SECONDS, TWO_SECONDS], 4, true)).toBe(120);
  });

  it("reports varies when the lengths differ", () => {
    expect(sharedBpmFromBeats([TWO_SECONDS, 4000], 4, true)).toBe("varies");
  });

  it("ignores samples with no length", () => {
    expect(sharedBpmFromBeats([null, TWO_SECONDS], 4, true)).toBe(120);
    expect(sharedBpmFromBeats([null, null], 4, true)).toBeNull();
  });
});

describe("sharedDuration", () => {
  it("collapses equal lengths and flags different ones", () => {
    expect(sharedDuration([TWO_SECONDS, TWO_SECONDS])).toBe(TWO_SECONDS);
    expect(sharedDuration([TWO_SECONDS, 4000])).toBe("varies");
    expect(sharedDuration([null])).toBeNull();
  });

  it("treats a sub-millisecond difference as the same length", () => {
    expect(sharedDuration([2000, 2000.4])).toBe(2000);
  });
});

describe("BEAT_PRESETS", () => {
  it("offers the bar counts a loop usually has", () => {
    expect([...BEAT_PRESETS]).toEqual([4, 8, 16, 32]);
  });
});
