import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_ORDER,
  dropIndexFromClientX,
  mergeColumnOrder,
  reorderByVisibleDrop,
  reorderColumn,
  visibleOrderedColumns,
} from "./columnOrder";
import { SOURCE_COLUMN_WIDTH, columnGridTemplate, DEFAULT_COLUMN_WIDTHS } from "./columnWidths";

describe("columnOrder", () => {
  it("mergeColumnOrder drops unknowns, dedupes, and appends missing defaults", () => {
    expect(mergeColumnOrder(null)).toEqual([...DEFAULT_COLUMN_ORDER]);
    expect(mergeColumnOrder(["tags", "name", "bogus", "name"])).toEqual([
      "tags",
      "name",
      "source",
      "type",
      "bpm",
      "key",
      "wave",
      "date_added",
      "date_created",
    ]);
  });

  it("includes source and date columns in the default order", () => {
    expect(DEFAULT_COLUMN_ORDER).toEqual([
      "name",
      "source",
      "type",
      "bpm",
      "key",
      "wave",
      "tags",
      "date_added",
      "date_created",
    ]);
  });

  it("reorderColumn moves an id to a new index", () => {
    const order = mergeColumnOrder(["name", "type", "bpm"]);
    expect(reorderColumn(order, "type", 0)[0]).toBe("type");
    expect(reorderColumn(order, "name", 2).slice(0, 3)).toEqual(["type", "bpm", "name"]);
  });

  it("visibleOrderedColumns respects hidden columns and waveform toggle", () => {
    const order = ["type", "name", "bpm", "key", "wave", "tags"] as const;
    expect(visibleOrderedColumns(order, new Set(["bpm", "tags"]), true)).toEqual([
      "type",
      "name",
      "key",
      "wave",
      "source",
      "date_added",
      "date_created",
    ]);
    expect(visibleOrderedColumns(order, new Set(["source", "date_added", "date_created"]), false)).toEqual([
      "type",
      "name",
      "bpm",
      "key",
      "tags",
    ]);
  });

  it("dropIndexFromClientX picks the slot from midpoints", () => {
    const visible = ["name", "type", "bpm"] as const;
    const rects = new Map<"name" | "type" | "bpm", { left: number; right: number }>([
      ["name", { left: 0, right: 100 }],
      ["type", { left: 100, right: 160 }],
      ["bpm", { left: 160, right: 220 }],
    ]);
    expect(dropIndexFromClientX(visible, "type", 40, rects)).toBe(0);
    expect(dropIndexFromClientX(visible, "name", 200, rects)).toBe(2);
  });

  it("reorderByVisibleDrop writes through to the full order", () => {
    const full = [...DEFAULT_COLUMN_ORDER];
    const visible = visibleOrderedColumns(full, new Set(["tags"]), true);
    const next = reorderByVisibleDrop(full, visible, "type", 0);
    expect(next[0]).toBe("type");
    expect(next.indexOf("tags")).toBeGreaterThan(next.indexOf("wave"));
  });
});

describe("columnGridTemplate source track", () => {
  it("uses a fixed px track for source", () => {
    const template = columnGridTemplate(["name", "source", "type"], DEFAULT_COLUMN_WIDTHS);
    expect(template).toContain(`${String(SOURCE_COLUMN_WIDTH)}px`);
  });
});
