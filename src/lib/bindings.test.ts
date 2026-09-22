import { describe, expect, it } from "vitest";
import { keys, matchesBinding, primaryModHeld, shiftHeld } from "./bindings";

function press(init: KeyboardEventInit & { code: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("matchesBinding", () => {
  it("matches ⌘/Ctrl+, for preferences", () => {
    expect(matchesBinding(press({ key: ",", code: "Comma", metaKey: true }), keys.preferences)).toBe(
      true,
    );
    expect(matchesBinding(press({ key: ",", code: "Comma", ctrlKey: true }), keys.preferences)).toBe(
      true,
    );
    expect(matchesBinding(press({ key: ",", code: "Comma" }), keys.preferences)).toBe(false);
  });

  it("distinguishes undo from redo", () => {
    expect(matchesBinding(press({ key: "z", code: "KeyZ", metaKey: true }), keys.undo)).toBe(true);
    expect(
      matchesBinding(press({ key: "z", code: "KeyZ", metaKey: true, shiftKey: true }), keys.undo),
    ).toBe(false);
    expect(
      matchesBinding(press({ key: "z", code: "KeyZ", metaKey: true, shiftKey: true }), keys.redo),
    ).toBe(true);
  });

  it("matches bare letter bindings without modifiers", () => {
    expect(matchesBinding(press({ key: "f", code: "KeyF" }), keys.favorite)).toBe(true);
    expect(matchesBinding(press({ key: "f", code: "KeyF", metaKey: true }), keys.favorite)).toBe(
      false,
    );
    expect(matchesBinding(press({ key: "k", code: "KeyK" }), keys.setKey)).toBe(true);
    expect(matchesBinding(press({ key: "b", code: "KeyB" }), keys.setBpm)).toBe(true);
    expect(matchesBinding(press({ key: "t", code: "KeyT", shiftKey: true }), keys.cycleType)).toBe(
      true,
    );
    expect(matchesBinding(press({ key: "t", code: "KeyT" }), keys.cycleType)).toBe(false);
  });

  it("matches Space and Enter", () => {
    expect(matchesBinding(press({ key: " ", code: "Space" }), keys.pause)).toBe(true);
    expect(matchesBinding(press({ key: "Enter", code: "Enter" }), keys.play)).toBe(true);
    expect(matchesBinding(press({ key: "Escape", code: "Escape" }), keys.dismiss)).toBe(true);
  });
});

describe("modifier helpers", () => {
  it("treats meta or ctrl as the primary mod", () => {
    expect(primaryModHeld({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(primaryModHeld({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(primaryModHeld({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("exposes shift for free-time / range gestures", () => {
    expect(shiftHeld({ shiftKey: true })).toBe(true);
    expect(shiftHeld({ shiftKey: false })).toBe(false);
  });

  it("lets Shift ride along with zero-crossing without a separate binding", () => {
    expect(matchesBinding(press({ key: "z", code: "KeyZ" }), keys.zeroCrossing)).toBe(true);
    expect(
      matchesBinding(press({ key: "z", code: "KeyZ", shiftKey: true }), keys.zeroCrossing),
    ).toBe(true);
  });
});

describe("hints", () => {
  it("keeps transport and menu hints non-empty", () => {
    expect(keys.play.hint).toBe("Enter");
    expect(keys.pause.hint).toBe("Space");
    expect(keys.freeTime.hint).toBe("⇧");
    expect(keys.favorite.hint).toBe("F");
  });
});
