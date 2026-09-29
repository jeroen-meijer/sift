import { describe, expect, it } from "vitest";
import { EMPTY_OMNI } from "./omni";
import { pendingChipFromSession, triggerEditorMode } from "./omniEditorSession";

describe("pendingChipFromSession", () => {
  it("only create chip editors are pending", () => {
    expect(
      pendingChipFromSession({
        kind: "tag",
        mode: "create",
        snapshot: EMPTY_OMNI,
      }),
    ).toBe("tag");
    expect(
      pendingChipFromSession({
        kind: "bpm",
        mode: "retrigger",
        snapshot: EMPTY_OMNI,
      }),
    ).toBeNull();
    expect(
      pendingChipFromSession({
        kind: "type",
        mode: "create",
        snapshot: EMPTY_OMNI,
      }),
    ).toBeNull();
  });
});

describe("triggerEditorMode", () => {
  it("creates when missing, retriggers bpm, edits others", () => {
    expect(triggerEditorMode("tag", EMPTY_OMNI)).toBe("create");
    expect(
      triggerEditorMode("bpm", { ...EMPTY_OMNI, bpmMin: 90, bpmMax: 92 }),
    ).toBe("retrigger");
    expect(
      triggerEditorMode("key", { ...EMPTY_OMNI, key: { pitchClass: 0, mode: "maj" } }),
    ).toBe("edit");
  });
});
