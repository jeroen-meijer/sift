import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { KeyEditor } from "./KeyEditor";

describe("KeyEditor", () => {
  it("reflects relative on the include toggle", () => {
    const { rerender } = render(
      <KeyEditor
        value={{ pitchClass: 9, mode: "min" }}
        relative={false}
        rootCounts={Array.from({ length: 12 }, () => 1)}
        onChange={vi.fn()}
        onToggleRelative={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("button", { name: /include relative/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.className).not.toContain(" on");

    rerender(
      <KeyEditor
        value={{ pitchClass: 9, mode: "min" }}
        relative
        rootCounts={Array.from({ length: 12 }, () => 1)}
        onChange={vi.fn()}
        onToggleRelative={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle.className).toContain(" on");
  });

  it("shows accidentals spanning two piano columns", () => {
    const { container } = render(
      <KeyEditor
        value={{ pitchClass: 9, mode: "min" }}
        relative={false}
        rootCounts={Array.from({ length: 12 }, () => 3)}
        onChange={vi.fn()}
        onToggleRelative={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const blacks = container.querySelectorAll(".omni-piano-row.blacks .omni-piano-cell");
    expect(blacks).toHaveLength(5);
    for (const cell of blacks) {
      expect(cell.classList.contains("span2")).toBe(true);
      expect((cell as HTMLElement).style.gridColumn).toMatch(/span 2/);
    }
  });
});
