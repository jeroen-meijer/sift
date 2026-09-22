import type { OptionalColumn } from "./omni";

/** Columns the user can drag to resize (fav stays fixed). */
export type ResizableColumn = "name" | OptionalColumn | "wave";

export type ColumnWidths = Record<ResizableColumn, number>;

export const FAV_COLUMN_WIDTH = 26;

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 220,
  type: 58,
  bpm: 46,
  key: 54,
  wave: 180,
  tags: 210,
};

export const MIN_COLUMN_WIDTHS: ColumnWidths = {
  name: 120,
  type: 44,
  bpm: 40,
  key: 44,
  wave: 100,
  tags: 96,
};

export function mergeColumnWidths(stored: Partial<ColumnWidths> | null | undefined): ColumnWidths {
  const next = { ...DEFAULT_COLUMN_WIDTHS };
  if (!stored) return next;
  for (const key of Object.keys(DEFAULT_COLUMN_WIDTHS) as ResizableColumn[]) {
    const value = stored[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = Math.max(MIN_COLUMN_WIDTHS[key], Math.round(value));
    }
  }
  return next;
}

export function clampColumnWidth(column: ResizableColumn, width: number): number {
  return Math.max(MIN_COLUMN_WIDTHS[column], Math.round(width));
}
