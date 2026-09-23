/**
 * Stable React keys for virtual rows that recycle DOM nodes.
 *
 * Keying rows by index mounts a new row (and a new canvas) for every row that
 * scrolls in. Here each visible index keeps its slot while it stays visible,
 * and rows entering the window take the slots of rows that left. Keys stay
 * unique within one render.
 */
export interface SlotState {
  byIndex: Map<number, number>;
  nextSlot: number;
}

export function emptySlots(): SlotState {
  return { byIndex: new Map(), nextSlot: 0 };
}

export function assignSlots(prev: SlotState, indices: readonly number[]): SlotState {
  const byIndex = new Map<number, number>();
  const used = new Set<number>();
  for (const index of indices) {
    const slot = prev.byIndex.get(index);
    if (slot !== undefined) {
      byIndex.set(index, slot);
      used.add(slot);
    }
  }
  const free: number[] = [];
  for (const slot of prev.byIndex.values()) {
    if (!used.has(slot)) free.push(slot);
  }
  let nextSlot = prev.nextSlot;
  for (const index of indices) {
    if (byIndex.has(index)) continue;
    let slot = free.pop();
    if (slot === undefined) {
      slot = nextSlot;
      nextSlot += 1;
    }
    byIndex.set(index, slot);
  }
  return { byIndex, nextSlot };
}
