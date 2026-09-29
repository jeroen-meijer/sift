import { describe, expect, it } from "vitest";
import { EMPTY_OMNI } from "./omni";
import {
  detectTrigger,
  parseOmniQuery,
  serializeOmniQuery,
  singleBpmRange,
  splitTrailingWord,
  triggerCompletions,
} from "./omniQuery";

describe("singleBpmRange", () => {
  it("expands to ±2", () => {
    expect(singleBpmRange(90)).toEqual({ min: 88, max: 92 });
  });
});

describe("splitTrailingWord", () => {
  it("splits the last token", () => {
    expect(splitTrailingWord("amen kick")).toEqual({ stem: "amen", word: "kick" });
    expect(splitTrailingWord("kick")).toEqual({ stem: "", word: "kick" });
  });
});

describe("detectTrigger", () => {
  it("fires on # at token start", () => {
    expect(detectTrigger("#")).toEqual({ kind: "tag", textWithoutTrigger: "" });
    expect(detectTrigger("kick #")).toEqual({ kind: "tag", textWithoutTrigger: "kick" });
  });

  it("fires when : completes b:/bpm:/k:/key:/tag:/type:", () => {
    expect(detectTrigger("b:")?.kind).toBe("bpm");
    expect(detectTrigger("bpm:")?.kind).toBe("bpm");
    expect(detectTrigger("k:")?.kind).toBe("key");
    expect(detectTrigger("key:")?.kind).toBe("key");
    expect(detectTrigger("tag:")?.kind).toBe("tag");
    expect(detectTrigger("type:")?.kind).toBe("type");
  });

  it("ignores mid-word colon", () => {
    expect(detectTrigger("dub:")).toBeNull();
  });
});

describe("parseOmniQuery", () => {
  it("parses the paste example and records chip order", () => {
    const { state, chipKinds } = parseOmniQuery(
      "b:89-95 k:amaj #kick -#vocals type:loop",
    );
    expect(state.bpmMin).toBe(89);
    expect(state.bpmMax).toBe(95);
    expect(state.key).toEqual({ pitchClass: 9, mode: "maj" });
    expect(state.tagsInclude).toEqual(["kick"]);
    expect(state.tagsExclude).toEqual(["vocals"]);
    expect(state.sampleType).toBe("loop");
    expect(state.text).toBe("");
    expect(chipKinds).toEqual(["bpm", "key", "tag"]);
  });

  it("expands single BPM to ±2", () => {
    const { state } = parseOmniQuery("b:90");
    expect(state.bpmMin).toBe(88);
    expect(state.bpmMax).toBe(92);
  });

  it("swaps BPM when min is above max", () => {
    const { state } = parseOmniQuery("b:120-90");
    expect(state.bpmMin).toBe(90);
    expect(state.bpmMax).toBe(120);
  });

  it("parses type:one-shot and free type words", () => {
    expect(parseOmniQuery("type:one-shot").state.sampleType).toBe("one-shot");
    expect(parseOmniQuery("type:oneshot").state.sampleType).toBe("one-shot");
  });

  it("keeps free text and loop word", () => {
    const { state } = parseOmniQuery("amen loop chop");
    expect(state.sampleType).toBe("loop");
    expect(state.text).toBe("amen chop");
  });

  it("merges tags into base", () => {
    const base = { ...EMPTY_OMNI, tagsInclude: ["drums"] };
    const { state } = parseOmniQuery("#kick", base);
    expect(state.tagsInclude).toEqual(["drums", "kick"]);
  });
});

describe("serializeOmniQuery", () => {
  it("round-trips the main filters", () => {
    const { state } = parseOmniQuery("b:89-95 k:am #drums/kick -#vocals type:loop amen");
    const s = serializeOmniQuery(state);
    expect(s).toContain("b:89-95");
    expect(s).toContain("k:am");
    expect(s).toContain("#drums/kick");
    expect(s).toContain("-#vocals");
    expect(s).toContain("type:loop");
    expect(s).toContain("amen");
  });

  it("serializes either key as root only", () => {
    expect(
      serializeOmniQuery({
        ...EMPTY_OMNI,
        key: { pitchClass: 0, mode: "either" },
      }),
    ).toBe("k:c");
  });
});

describe("triggerCompletions", () => {
  it("suggests bpm for bp", () => {
    expect(triggerCompletions("bp").some((c) => c.kind === "bpm")).toBe(true);
  });
});
