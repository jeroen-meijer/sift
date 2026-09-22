import { describe, expect, it } from "vitest";
import { hotkeyId, hotkeyLabel, matchesHotkey } from "./hotkey";

function press(init: KeyboardEventInit & { code: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("hotkeyId", () => {
  it("records the code with its modifiers", () => {
    expect(hotkeyId(press({ key: "h", code: "KeyH", altKey: true }))).toBe("alt+KeyH");
    expect(hotkeyId(press({ key: " ", code: "Space" }))).toBe("Space");
  });

  it("refuses a bare modifier", () => {
    expect(hotkeyId(press({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
  });
});

describe("hotkeyLabel", () => {
  it("prints the symbols the design uses", () => {
    expect(hotkeyLabel("alt+KeyH")).toBe("⌥H");
    expect(hotkeyLabel("meta+shift+Digit1")).toBe("⌘⇧1");
    expect(hotkeyLabel("Space")).toBe("Space");
  });

  it("has no label for an unbound key", () => {
    expect(hotkeyLabel(null)).toBeNull();
  });
});

describe("matchesHotkey", () => {
  it("matches only the exact combination", () => {
    const event = press({ key: "h", code: "KeyH", altKey: true });
    expect(matchesHotkey(event, "alt+KeyH")).toBe(true);
    expect(matchesHotkey(event, "KeyH")).toBe(false);
    expect(matchesHotkey(event, null)).toBe(false);
  });
});
