import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function omniInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector(".omni-input");
  if (!(input instanceof HTMLInputElement)) throw new Error("expected .omni-input");
  return input;
}

function chipKinds(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".omni-chip .omni-chip-pre")].map(
    (el) => el.textContent?.trim().toLowerCase() ?? "",
  );
}

function openBpmEditor(container: HTMLElement) {
  fireEvent.change(omniInput(container), { target: { value: "bpm:" } });
  expect(container.querySelector(".omni-editor-anchor")).not.toBeNull();
}

describe("OmniSearch paste", () => {
  it("parses a pasted typed query into chips and type control", () => {
    const { container } = render(<Harness />);
    const input = omniInput(container);

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

    fireEvent.change(omniInput(container), { target: { value: "tag:" } });

    expect(chipKinds(container)).toEqual(["bpm", "key", "tag"]);
  });

  it("keeps paste token order when several chips are created together", () => {
    const { container } = render(<Harness />);

    fireEvent.paste(omniInput(container), {
      clipboardData: {
        getData: () => "b:120 k:am #drums",
      },
    });

    expect(chipKinds(container)).toEqual(["bpm", "key", "tag"]);
  });
});

describe("OmniSearch filter editors", () => {
  it("closes the BPM editor when clicking back into the main field", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    openBpmEditor(container);

    await user.click(omniInput(container));

    expect(container.querySelector(".omni-editor-anchor")).toBeNull();
  });

  it("keeps focus on the BPM max field when clicking it", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    openBpmEditor(container);

    const max = container.querySelectorAll(".omni-bpm-input")[1];
    if (!(max instanceof HTMLInputElement)) throw new Error("expected max bpm input");
    await user.click(max);

    expect(document.activeElement).toBe(max);
    expect(container.querySelector(".omni-editor-anchor")).not.toBeNull();
  });

  it("selects the BPM chip on pointer down so the field ring does not flicker off first", () => {
    const { container } = render(
      <Harness initial={{ ...EMPTY_OMNI, bpmMin: 100, bpmMax: 104 }} />,
    );
    const field = container.querySelector(".omni-field");
    const chip = container.querySelector(".omni-chip");
    const input = omniInput(container);
    if (!(field instanceof HTMLElement) || !(chip instanceof HTMLElement)) {
      throw new Error("expected field and bpm chip");
    }

    input.focus();
    expect(field.matches(":focus-within")).toBe(true);
    expect(chip.className).not.toContain("selected");

    fireEvent.pointerDown(chip, { button: 0 });

    expect(chip.className).toContain("selected");
    expect(container.querySelector(".omni-editor-anchor")).not.toBeNull();
  });

  it("toggles the BPM editor closed when clicking the BPM chip", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness initial={{ ...EMPTY_OMNI, bpmMin: 100, bpmMax: 104 }} />,
    );

    const chip = container.querySelector(".omni-chip");
    if (!(chip instanceof HTMLElement)) throw new Error("expected bpm chip");
    await user.click(chip);
    expect(container.querySelector(".omni-editor-anchor")).not.toBeNull();

    await user.click(chip);
    expect(container.querySelector(".omni-editor-anchor")).toBeNull();
  });

  it("keeps focus on the key editor input when clicking it", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness
        initial={{
          ...EMPTY_OMNI,
          key: { pitchClass: 0, mode: "min" },
        }}
      />,
    );

    const chip = container.querySelector(".omni-chip");
    if (!(chip instanceof HTMLElement)) throw new Error("expected key chip");
    await user.click(chip);

    const keyField = container.querySelector(".omni-key-input");
    if (!(keyField instanceof HTMLInputElement)) throw new Error("expected key input");
    await user.click(keyField);

    expect(document.activeElement).toBe(keyField);
    expect(container.querySelector(".omni-editor-anchor")).not.toBeNull();
  });

  it("closes any open editor when clicking back into the main field", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness
        initial={{
          ...EMPTY_OMNI,
          key: { pitchClass: 9, mode: "min" },
        }}
      />,
    );

    const chip = container.querySelector(".omni-chip");
    if (!(chip instanceof HTMLElement)) throw new Error("expected key chip");
    await user.click(chip);
    expect(container.querySelector(".omni-editor-anchor")).not.toBeNull();

    await user.click(omniInput(container));
    expect(container.querySelector(".omni-editor-anchor")).toBeNull();
  });
});
