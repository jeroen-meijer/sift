import type { OptionalColumn } from "./omni";

/**
 * Content columns that participate in order / visibility. Fav stays outside.
 * `source` is fixed-width (like fav); the rest are resizable fr tracks.
 */
export type TableColumn = "name" | OptionalColumn | "wave";

/** Columns the user can drag to resize (fav and source stay fixed). */
export type ResizableColumn = Exclude<TableColumn, "source">;

export type ColumnWidths = Record<ResizableColumn, number>;

export const FAV_COLUMN_WIDTH = 26;
/** Fixed track for the Source column (header + Splice icon). */
export const SOURCE_COLUMN_WIDTH = 54;

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  name: 220,
  type: 58,
  bpm: 46,
  key: 54,
  wave: 180,
  tags: 210,
  date_added: 110,
  date_created: 110,
};

export const MIN_COLUMN_WIDTHS: ColumnWidths = {
  name: 120,
  type: 44,
  bpm: 40,
  key: 44,
  wave: 100,
  tags: 96,
  date_added: 72,
  date_created: 72,
};

export function isResizableColumn(column: TableColumn): column is ResizableColumn {
  return column !== "source";
}

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

/**
 * CSS grid track list for the sample table. Stored widths are relative weights
 * (`fr`), floored by each column's min px so a wide pane scales columns
 * together instead of parking leftover space in a trailing absorber.
 * Source uses a fixed px track like fav.
 */
export function columnGridTemplate(
  columns: readonly TableColumn[],
  widths: ColumnWidths,
): string {
  const parts = [`${String(FAV_COLUMN_WIDTH)}px`];
  for (const column of columns) {
    if (column === "source") {
      parts.push(`${String(SOURCE_COLUMN_WIDTH)}px`);
      continue;
    }
    const min = MIN_COLUMN_WIDTHS[column];
    const weight = Math.max(1, widths[column]);
    parts.push(`minmax(${String(min)}px, ${String(weight)}fr)`);
  }
  /* Trailing gutter cell stays zero-width; free space goes to the fr columns. */
  parts.push("0px");
  return parts.join(" ");
}
