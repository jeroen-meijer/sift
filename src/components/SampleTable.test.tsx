import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import type { SampleRow } from "../lib/ipc";
import { SampleTable } from "./SampleTable";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("no peaks in tests"))),
}));

function sample(overrides: Partial<SampleRow> = {}): SampleRow {
  return {
    id: 1,
    root_id: 1,
    path: "/Samples/Drums/Kicks/kick_tight_90.wav",
    filename: "kick_tight_90.wav",
    parent_path: "/Samples/Drums/Kicks",
    extension: "wav",
    size_bytes: 120_000,
    missing: false,
    sample_rate: 44_100,
    bit_depth: 24,
    channels: 2,
    duration_ms: 1240,
    format: "wav",
    bpm: 90,
    key_name: null,
    sample_type: "one-shot",
    favorite: false,
    tags: [{ id: 7, path: "Drums/Kick", color: null }],
    ...overrides,
  };
}

const noop = () => undefined;

function renderTable(props: Partial<React.ComponentProps<typeof SampleTable>> = {}) {
  return render(
    <SampleTable
      samples={[sample()]}
      indexedCount={4402}
      selectedIds={new Set()}
      playingId={null}
      playingProgress={null}
      analyzingIds={new Set()}
      showWaveforms
      hiddenColumns={new Set()}
      sortColumn="name"
      sortDirection="asc"
      highlightText=""
      hoverPreviewHeld={false}
      onSelect={noop}
      onHoverPreview={noop}
      onToggleFavorite={noop}
      onSort={noop}
      onOpenMenu={noop}
      onDragSelected={noop}
      onScrubRow={noop}
      columnWidths={{
        name: 220,
        type: 58,
        bpm: 46,
        key: 54,
        wave: 180,
        tags: 210,
      }}
      onColumnWidthsChange={noop}
      {...props}
    />,
  );
}

describe("SampleTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an em dash for a missing BPM or key, the way the design does", () => {
    renderTable({ samples: [sample({ bpm: null, key_name: null })] });
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("marks the sorted column and leaves the others unmarked", () => {
    renderTable({ sortColumn: "bpm", sortDirection: "desc" });
    expect(screen.getByRole("button", { name: "BPM" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("button", { name: "Name" })).toHaveAttribute("aria-sort", "none");
  });

  it("drops a hidden column from the header and the rows", () => {
    renderTable({ hiddenColumns: new Set(["tags"] as const) });
    expect(screen.queryByText("Tags")).toBeNull();
    expect(screen.queryByText("Drums/Kick")).toBeNull();
  });

  it("omits the waveform column entirely when row waveforms are off", () => {
    renderTable({ showWaveforms: false });
    expect(screen.queryByText("Waveform")).toBeNull();
  });

  it("shows the tag path, not the leaf name", () => {
    renderTable();
    expect(screen.getByText("Drums/Kick")).toBeVisible();
  });

  it("swaps the tags cell for an analysing label while a row is queued", () => {
    renderTable({ analyzingIds: new Set([1]) });
    expect(screen.getByText("Analyzing…")).toBeVisible();
    expect(screen.queryByText("Drums/Kick")).toBeNull();
  });

  it("highlights the search hit inside the filename", () => {
    const { container } = renderTable({ highlightText: "tight" });
    expect(container.querySelector("mark")?.textContent).toBe("tight");
  });

  it("blanks the type of a missing sample and strikes its name", () => {
    const { container } = renderTable({ samples: [sample({ missing: true })] });
    expect(screen.queryByText("one-shot")).toBeNull();
    expect(container.querySelector(".sample-row.missing")).not.toBeNull();
  });

  it("offers the empty state with the indexed count when nothing matches", () => {
    renderTable({ samples: [] });
    expect(screen.getByText("No samples match")).toBeVisible();
    expect(screen.getByText(/4,402 files are indexed\./)).toBeVisible();
  });

  it("labels the favourite toggle by its current state", () => {
    const { rerender } = renderTable();
    expect(screen.getByRole("button", { name: "Favorite" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(
      <SampleTable
        samples={[sample({ favorite: true })]}
        indexedCount={1}
        selectedIds={new Set()}
        playingId={null}
        playingProgress={null}
        analyzingIds={new Set()}
        showWaveforms
        hiddenColumns={new Set()}
        sortColumn="name"
        sortDirection="asc"
        highlightText=""
        hoverPreviewHeld={false}
        onSelect={noop}
        onHoverPreview={noop}
        onToggleFavorite={noop}
        onSort={noop}
        onOpenMenu={noop}
        onDragSelected={noop}
        onScrubRow={noop}
        columnWidths={{
          name: 220,
          type: 58,
          bpm: 46,
          key: 54,
          wave: 180,
          tags: 210,
        }}
        onColumnWidthsChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Unfavorite" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("marks the playing row", () => {
    const { container } = renderTable({ playingId: 1, playingProgress: 0.4 });
    expect(container.querySelector(".sample-row .col.fav.playing")).not.toBeNull();
    expect(container.querySelector(".sample-row .fav-play")).not.toBeNull();
  });
});
