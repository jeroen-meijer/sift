import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTHS,
  columnGridTemplate,
} from "./columnWidths";

describe("columnGridTemplate", () => {
  it("uses fr weights with per-column minmax floors", () => {
    const template = columnGridTemplate(
      ["name", "type", "bpm"],
      DEFAULT_COLUMN_WIDTHS,
    );
    expect(template.startsWith("26px ")).toBe(true);
    expect(template).toContain(
      `minmax(${String(MIN_COLUMN_WIDTHS.name)}px, ${String(DEFAULT_COLUMN_WIDTHS.name)}fr)`,
    );
    expect(template).toContain(
      `minmax(${String(MIN_COLUMN_WIDTHS.type)}px, ${String(DEFAULT_COLUMN_WIDTHS.type)}fr)`,
    );
    expect(template.endsWith(" 0px")).toBe(true);
    expect(template.includes("1fr")).toBe(false);
  });

  it("keeps a floor of 1fr even if a stored weight is tiny", () => {
    const template = columnGridTemplate(["bpm"], {
      ...DEFAULT_COLUMN_WIDTHS,
      bpm: 0,
    });
    expect(template).toContain(`minmax(${String(MIN_COLUMN_WIDTHS.bpm)}px, 1fr)`);
  });
});
