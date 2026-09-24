import { describe, expect, it } from "vitest";
import type { SampleRow } from "./ipc";
import { patchRows } from "./patchRows";

function row(id: number, bpm: number | null = null): SampleRow {
  return {
    id,
    root_id: 1,
    path: `/x/${String(id)}.wav`,
    filename: `${String(id)}.wav`,
    parent_path: "/x",
    extension: "wav",
    size_bytes: null,
    missing: false,
    availability: "local",
    sample_rate: null,
    bit_depth: null,
    channels: null,
    duration_ms: null,
    format: null,
    bpm,
    key_name: null,
    sample_type: null,
    favorite: false,
    tags: [],
    catalog_source: null,
    bpm_source: null,
    key_source: null,
    sample_type_source: null,
    date_added_ms: null,
    date_created_ms: null,
  };
}

describe("patchRows", () => {
  it("replaces matching rows and keeps identity for the rest", () => {
    const rows = [row(1), row(2), row(3)];
    const next = patchRows(rows, [row(2, 120)]);
    expect(next).not.toBe(rows);
    expect(next[0]).toBe(rows[0]);
    expect(next[2]).toBe(rows[2]);
    expect(next[1]?.bpm).toBe(120);
  });

  it("returns the same array when nothing matched", () => {
    const rows = [row(1)];
    expect(patchRows(rows, [row(9)])).toBe(rows);
    expect(patchRows(rows, [])).toBe(rows);
  });
});
