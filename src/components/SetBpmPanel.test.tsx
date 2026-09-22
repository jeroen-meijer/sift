import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import type { SampleRow } from "../lib/ipc";
import { SetBpmPanel } from "./SetBpmPanel";

function sample(overrides: Partial<SampleRow> = {}): SampleRow {
  return {
    id: 1,
    root_id: 1,
    path: "/Samples/loop.wav",
    filename: "loop.wav",
    parent_path: "/Samples",
    extension: "wav",
    size_bytes: 1000,
    missing: false,
    sample_rate: 44_100,
    bit_depth: 24,
    channels: 2,
    // 2 seconds: 4 beats = 120 BPM, 8 beats = 240 BPM.
    duration_ms: 2000,
    format: "wav",
    bpm: 120,
    key_name: null,
    sample_type: "loop",
    favorite: false,
    tags: [],
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof SetBpmPanel>> = {}) {
  const handlers = {
    onRoundChange: vi.fn(),
    onSetBpm: vi.fn(),
    onSetFromBeats: vi.fn(),
    onClear: vi.fn(),
  };
  const target = props.focused ?? sample();
  render(
    <SetBpmPanel
      targets={[target]}
      focused={target}
      bpmMin={70}
      bpmMax={180}
      round
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

/** The BPM a beat row previews, read from its own cell. */
function previewOf(label: RegExp): string | undefined {
  return screen
    .getByRole("button", { name: label })
    .querySelector(".bpm-panel-number")?.textContent ?? undefined;
}

describe("SetBpmPanel", () => {
  it("previews the BPM each beat count would produce", () => {
    renderPanel();
    expect(previewOf(/4 beats/)).toBe("120");
    expect(previewOf(/8 beats/)).toBe("240");
  });

  it("keeps the arrows in one column and the numbers flush right", () => {
    const { container } = render(
      <SetBpmPanel
        targets={[sample()]}
        focused={sample()}
        bpmMin={70}
        bpmMax={180}
        round
        onRoundChange={vi.fn()}
        onSetBpm={vi.fn()}
        onSetFromBeats={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    // One arrow cell and one number cell per preview, never a combined string.
    expect(container.querySelectorAll(".bpm-panel-arrow")).toHaveLength(4);
    expect(container.querySelectorAll(".bpm-panel-number")).toHaveLength(4);
    expect(container.querySelector(".bpm-panel-beats .menu-icon")).toBeNull();
  });

  it("mutes beat counts that land outside the analysis range", () => {
    renderPanel();
    // 240 BPM is past the 70-180 range, 120 sits inside it.
    expect(screen.getByRole("button", { name: /8 beats/ })).toHaveClass("muted");
    expect(screen.getByRole("button", { name: /4 beats/ })).not.toHaveClass("muted");
  });

  it("ticks the beat count the stored BPM already implies", () => {
    const { container } = render(
      <SetBpmPanel
        targets={[sample()]}
        focused={sample()}
        bpmMin={70}
        bpmMax={180}
        round
        onRoundChange={vi.fn()}
        onSetBpm={vi.fn()}
        onSetFromBeats={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const ticked = [...container.querySelectorAll(".bpm-panel-beats.current")];
    expect(ticked).toHaveLength(1);
    expect(ticked[0]).toHaveTextContent("4 beats");
    expect(ticked[0]?.querySelector(".bpm-panel-tick")).not.toBeNull();
  });

  it("reports the length once for a selection that shares it", () => {
    renderPanel({ targets: [sample(), sample({ id: 2 })] });
    expect(screen.getByText("2.00 s")).toBeVisible();
  });

  it("says varies when the selection has different lengths", () => {
    renderPanel({ targets: [sample(), sample({ id: 2, duration_ms: 4000 })] });
    expect(screen.getAllByText("varies").length).toBeGreaterThan(0);
    expect(previewOf(/4 beats/)).toBe("varies");
  });

  it("hands the beat count up, not a computed BPM", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel();
    await user.click(screen.getByRole("button", { name: /16 beats/ }));
    expect(handlers.onSetFromBeats).toHaveBeenCalledWith(16);
    expect(handlers.onSetBpm).not.toHaveBeenCalled();
  });

  it("applies a typed BPM on Enter", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel();
    const field = screen.getByRole("textbox", { name: "BPM" });
    await user.clear(field);
    await user.type(field, "174{Enter}");
    expect(handlers.onSetBpm).toHaveBeenCalledWith(174);
  });

  it("ignores an empty or nonsense BPM", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel();
    const field = screen.getByRole("textbox", { name: "BPM" });
    await user.clear(field);
    await user.type(field, "{Enter}");
    await user.type(field, "abc{Enter}");
    expect(handlers.onSetBpm).not.toHaveBeenCalled();
  });

  it("previews a custom beat count as you type it", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole("textbox", { name: "beats" }), "2");
    // 2 beats over 2 seconds is 60 BPM.
    expect(screen.getByText("60")).toHaveClass("bpm-panel-number");
  });

  it("offers the beats section only when a length is known", () => {
    renderPanel({ focused: sample({ duration_ms: null }), targets: [sample({ duration_ms: null })] });
    expect(screen.queryByRole("button", { name: /4 beats/ })).toBeNull();
    expect(screen.getByText(/needs the sample's length/)).toBeVisible();
  });

  it("cannot clear a BPM that is not set", () => {
    renderPanel({ focused: sample({ bpm: null }), targets: [sample({ bpm: null })] });
    expect(screen.getByRole("button", { name: /Clear BPM/ })).toBeDisabled();
  });
});
