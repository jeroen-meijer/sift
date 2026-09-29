import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { BpmEditor } from "./BpmEditor";

describe("BpmEditor", () => {
  it("reflects half/double on the header toggle", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <BpmEditor
        value={{ min: 88, max: 92 }}
        halfDouble={false}
        bpmValues={[90]}
        onChange={vi.fn()}
        onToggleHalfDouble={onToggle}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("button", { name: /half \/ double/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.className).not.toContain(" on");

    rerender(
      <BpmEditor
        value={{ min: 88, max: 92 }}
        halfDouble
        bpmValues={[90]}
        onChange={vi.fn()}
        onToggleHalfDouble={onToggle}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle.className).toContain(" on");
  });

  it("uses one dual-thumb range slider and no presets", () => {
    const { container } = render(
      <BpmEditor
        value={{ min: 59, max: 65 }}
        halfDouble={false}
        bpmValues={[60, 120]}
        onChange={vi.fn()}
        onToggleHalfDouble={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelectorAll(".range-slider")).toHaveLength(1);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(2);
    expect(container.querySelector(".omni-bpm-presets")).toBeNull();
    expect(screen.queryByRole("button", { name: "70–80" })).toBeNull();
  });

  it("drags the dual slider into onChange", () => {
    const onChange = vi.fn();
    const { container } = render(
      <BpmEditor
        value={{ min: 80, max: 100 }}
        halfDouble={false}
        bpmValues={[]}
        onChange={onChange}
        onToggleHalfDouble={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const inputs = container.querySelectorAll('input[type="range"]');
    const high = inputs[1];
    if (!(high instanceof HTMLInputElement)) throw new Error("expected high thumb");
    fireEvent.change(high, { target: { value: "140" } });
    expect(onChange).toHaveBeenCalledWith({ min: 80, max: 140 });
  });
});
