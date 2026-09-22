import { describe, expect, it } from "vitest";
import { beatsBetween, formatBytes, formatCount, formatDb, formatSpan, formatTime } from "./format";

describe("formatBytes", () => {
  it("prints one decimal below 10 and whole numbers above", () => {
    expect(formatBytes(3_250_586)).toBe("3.1 MB");
    expect(formatBytes(432_013_312)).toBe("412 MB");
  });

  it("keeps bytes whole", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("treats nothing and nonsense as zero", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatTime", () => {
  it("prints the ruler format the design uses", () => {
    expect(formatTime(0)).toBe("0:00.00");
    expect(formatTime(0.25)).toBe("0:00.25");
    expect(formatTime(64.5)).toBe("1:04.50");
  });

  it("clamps negatives to zero", () => {
    expect(formatTime(-3)).toBe("0:00.00");
  });
});

describe("formatDb", () => {
  it("uses a real minus sign, not a hyphen", () => {
    expect(formatDb(-4.5)).toBe("−4.5 dB");
    expect(formatDb(-4.5).startsWith("-")).toBe(false);
  });

  it("signs positive gain and leaves zero unsigned", () => {
    expect(formatDb(3)).toBe("+3.0 dB");
    expect(formatDb(0)).toBe("0.0 dB");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(4402)).toBe("4,402");
  });
});

describe("beatsBetween / formatSpan", () => {
  it("counts beats at the sample's BPM", () => {
    expect(beatsBetween(0, 2, 120)).toBeCloseTo(4);
  });

  it("prints bars once the span reaches one", () => {
    expect(formatSpan(0, 4, 120)).toBe("2 bars");
    expect(formatSpan(0, 2, 120)).toBe("1 bar");
  });

  it("falls back to beats below a bar", () => {
    expect(formatSpan(0, 1, 120)).toBe("2 beats");
  });

  it("returns null without a BPM", () => {
    expect(formatSpan(0, 1, null)).toBeNull();
    expect(beatsBetween(0, 1, 0)).toBeNull();
  });
});
