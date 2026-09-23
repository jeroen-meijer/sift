import type { SampleRow } from "./ipc";

/**
 * Replace rows by id with fresh copies. Untouched rows keep their identity so
 * memoized rows skip rendering; returns the same array when nothing matched.
 */
export function patchRows(rows: SampleRow[], updates: readonly SampleRow[]): SampleRow[] {
  if (updates.length === 0) return rows;
  const byId = new Map(updates.map((u) => [u.id, u] as const));
  if (!rows.some((row) => byId.has(row.id))) return rows;
  return rows.map((row) => byId.get(row.id) ?? row);
}
