import { describe, expect, it } from "vitest";
import { applyTheme, THEMES } from "./index";

describe("theme", () => {
  it("registers dark-default", () => {
    expect(THEMES).toContain("dark-default");
  });

  it("applyTheme sets data-theme", () => {
    applyTheme("dark-default");
    expect(document.documentElement.dataset.theme).toBe("dark-default");
  });
});
