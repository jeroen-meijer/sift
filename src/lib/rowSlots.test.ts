import { describe, expect, it } from "vitest";
import { assignSlots, emptySlots } from "./rowSlots";

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("assignSlots", () => {
  it("keeps the slot of an index that stays visible", () => {
    const a = assignSlots(emptySlots(), range(0, 9));
    const b = assignSlots(a, range(3, 12));
    for (const i of range(3, 9)) expect(b.byIndex.get(i)).toBe(a.byIndex.get(i));
  });

  it("gives entering rows the slots of rows that left", () => {
    const a = assignSlots(emptySlots(), range(0, 9));
    const b = assignSlots(a, range(100, 109));
    const before = new Set(a.byIndex.values());
    const after = new Set(b.byIndex.values());
    expect(after).toEqual(before);
    expect(b.nextSlot).toBe(a.nextSlot);
  });

  it("only creates new slots when the window grows", () => {
    const a = assignSlots(emptySlots(), range(0, 9));
    const b = assignSlots(a, range(50, 64));
    expect(b.nextSlot).toBe(15);
    expect(new Set(b.byIndex.values()).size).toBe(15);
  });
});
