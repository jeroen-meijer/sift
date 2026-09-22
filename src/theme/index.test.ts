import { describe, expect, it } from "vitest";
import { THEMES, applyTheme, normalizeThemeId } from "./index";

describe("theme", () => {
  it("ships Nocturne plus the Monospace set", () => {
    expect(THEMES).toEqual(["nocturne", "ink", "graphite", "snow"]);
  });

  it("maps the legacy dark-default id to nocturne", () => {
    expect(normalizeThemeId("dark-default")).toBe("nocturne");
    expect(normalizeThemeId("ink")).toBe("ink");
    expect(normalizeThemeId("nope")).toBe("nocturne");
  });

  it("applyTheme sets data-theme to a known id", () => {
    applyTheme("dark-default");
    expect(document.documentElement.dataset.theme).toBe("nocturne");
    applyTheme("graphite");
    expect(document.documentElement.dataset.theme).toBe("graphite");
  });
});
