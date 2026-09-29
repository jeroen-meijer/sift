import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { EMPTY_OMNI, type OmniState, type OptionalColumn } from "../lib/omni";
import { OmniSearch } from "./OmniSearch";

const columnLabels: Record<OptionalColumn, string> = {
  source: "Source",
  type: "Type",
  bpm: "BPM",
  key: "Key",
  wave: "Waveform",
  tags: "Tags",
  date_added: "Added",
  date_created: "Created",
};

function Harness({ initial = EMPTY_OMNI }: { initial?: OmniState }) {
  const [value, setValue] = useState(initial);
  return (
    <OmniSearch
      value={value}
      onChange={setValue}
      folders={[]}
      tags={[]}
      halfDouble={false}
      relativeKey={false}
      onToggleHalfDouble={vi.fn()}
      onToggleRelativeKey={vi.fn()}
      favoritesOnly={false}
      onToggleFavoritesOnly={vi.fn()}
      hiddenColumns={new Set()}
      onToggleColumn={vi.fn()}
      columnLabels={columnLabels}
      facetBpms={[]}
      facetRootCounts={[]}
      facetTagCounts={new Map()}
      onEditorKindChange={vi.fn()}
    />
  );
}

function chipKinds(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".omni-chip .omni-chip-pre")].map(
    (el) => el.textContent?.trim().toLowerCase() ?? "",
  );
}

describe("OmniSearch paste", () => {
  it("parses a pasted typed query into chips and type control", () => {
    const { container } = render(<Harness />);
    const input = container.querySelector(".omni-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("expected .omni-input");
    }

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "b:89-95 k:am type:loop",
      },
    });

    expect(container.querySelectorAll(".omni-chip").length).toBeGreaterThanOrEqual(2);
    expect(container.textContent?.toLowerCase()).toMatch(/bpm/);
    expect(container.textContent?.toLowerCase()).toMatch(/key|a\s*min/);
    const loop = screen.getByRole("button", { name: /loop/i });
    expect(loop.className).toContain("on");
  });
});

describe("OmniSearch chip order", () => {
  it("appends a new tag chip after existing bpm and key chips", () => {
    const { container } = render(
      <Harness
        initial={{
          ...EMPTY_OMNI,
          bpmMin: 170,
          bpmMax: 175,
          key: { pitchClass: 6, mode: "min" },
        }}
      />,
    );

    expect(chipKinds(container)).toEqual(["bpm", "key"]);

    const input = container.querySelector(".omni-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("expected .omni-input");
    }
    fireEvent.change(input, { target: { value: "tag:" } });

    expect(chipKinds(container)).toEqual(["bpm", "key", "tag"]);
  });

  it("keeps paste token order when several chips are created together", () => {
    const { container } = render(<Harness />);
    const input = container.querySelector(".omni-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("expected .omni-input");
    }

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "b:120 k:am #drums",
      },
    });

    expect(chipKinds(container)).toEqual(["bpm", "key", "tag"]);
  });
});
