import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { CopyableText } from "./CopyableText";

describe("CopyableText", () => {
  it("copies text on click and shows the check state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<CopyableText text="/full/path/to/file.wav" display="file.wav" />);
    expect(screen.getByText("file.wav")).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("/full/path/to/file.wav");
    });
    await waitFor(() => {
      expect(screen.getByRole("button").className).toContain("copied");
    });
  });
});
