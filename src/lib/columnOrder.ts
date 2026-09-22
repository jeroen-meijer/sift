import type { OptionalColumn } from "./omni";
import type { ResizableColumn } from "./columnWidths";

/** Default left→right order for content columns (fav stays pinned outside). */
export const DEFAULT_COLUMN_ORDER: readonly ResizableColumn[] = [
  "name",
  "type",
  "bpm",
  "key",
  "wave",
  "tags",
];

const ORDER_SET = new Set<string>(DEFAULT_COLUMN_ORDER);

function isResizableColumn(value: unknown): value is ResizableColumn {
  return typeof value === "string" && ORDER_SET.has(value);
}

/** Validate stored order: known ids only, no dupes, append any missing defaults. */
export function mergeColumnOrder(
  stored: readonly unknown[] | null | undefined,
): ResizableColumn[] {
  const next: ResizableColumn[] = [];
  const seen = new Set<ResizableColumn>();
  if (Array.isArray(stored)) {
    for (const item of stored) {
      if (!isResizableColumn(item) || seen.has(item)) continue;
      next.push(item);
      seen.add(item);
    }
  }
  for (const column of DEFAULT_COLUMN_ORDER) {
    if (!seen.has(column)) next.push(column);
  }
  return next;
}

/** Move `fromId` so it lands at `toIndex` in the full order array. */
export function reorderColumn(
  order: readonly ResizableColumn[],
  fromId: ResizableColumn,
  toIndex: number,
): ResizableColumn[] {
  const from = order.indexOf(fromId);
  if (from < 0) return [...order];
  const clamped = Math.max(0, Math.min(order.length - 1, toIndex));
  if (from === clamped) return [...order];
  const next = [...order];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...order];
  next.splice(clamped, 0, item);
  return next;
}

/**
 * Visible content columns in user order. Hidden optional columns and the wave
 * column (when waveforms are off) are filtered out; order of the rest is kept.
 */
export function visibleOrderedColumns(
  order: readonly ResizableColumn[],
  hidden: ReadonlySet<OptionalColumn>,
  showWaveforms: boolean,
): ResizableColumn[] {
  const merged = mergeColumnOrder(order);
  return merged.filter((column) => {
    if (column === "wave") return showWaveforms;
    if (column === "name") return true;
    return !hidden.has(column);
  });
}

/**
 * Final index of `dragged` among `visible` for a pointer x, using midpoints of
 * the other columns (how many we've passed).
 */
export function dropIndexFromClientX(
  visible: readonly ResizableColumn[],
  dragged: ResizableColumn,
  clientX: number,
  rects: ReadonlyMap<ResizableColumn, { left: number; right: number }>,
): number {
  if (!visible.includes(dragged) || visible.length === 0) return 0;
  let passed = 0;
  for (const id of visible) {
    if (id === dragged) continue;
    const rect = rects.get(id);
    if (!rect) continue;
    const mid = (rect.left + rect.right) / 2;
    if (clientX >= mid) passed += 1;
  }
  return passed;
}

/** Apply a visible-list drop onto the full persisted order. */
export function reorderByVisibleDrop(
  fullOrder: readonly ResizableColumn[],
  visible: readonly ResizableColumn[],
  dragged: ResizableColumn,
  visibleToIndex: number,
): ResizableColumn[] {
  const without = fullOrder.filter((c) => c !== dragged);
  const visibleWithout = visible.filter((c) => c !== dragged);
  const clamped = Math.max(0, Math.min(visibleWithout.length, visibleToIndex));
  if (clamped >= visibleWithout.length) {
    const last = visibleWithout[visibleWithout.length - 1];
    if (last === undefined) return [...without, dragged];
    const idx = without.indexOf(last);
    if (idx < 0) return [...without, dragged];
    const next = [...without];
    next.splice(idx + 1, 0, dragged);
    return next;
  }
  const before = visibleWithout[clamped];
  if (before === undefined) return [...without, dragged];
  const insertAt = without.indexOf(before);
  if (insertAt < 0) return [...without, dragged];
  const next = [...without];
  next.splice(insertAt, 0, dragged);
  return next;
}
