import { describe, expect, it } from "vitest";
import { shellMode } from "./shellMode";
import type { DbStats } from "./ipc";

const stats = (roots: number): DbStats => ({
  roots,
  samples: 0,
  missing: 0,
  tags: 0,
  data_dir: "",
  clips_dir: "",
  clips_bytes: 0,
});

describe("shellMode", () => {
  it("stays in boot until settings and stats are both known", () => {
    expect(shellMode(false, null)).toBe("boot");
    expect(shellMode(true, null)).toBe("boot");
    expect(shellMode(false, stats(2))).toBe("boot");
  });

  it("shows first-launch only when roots are known to be zero", () => {
    expect(shellMode(true, stats(0))).toBe("empty");
  });

  it("shows the library when roots exist", () => {
    expect(shellMode(true, stats(1))).toBe("library");
  });
});
