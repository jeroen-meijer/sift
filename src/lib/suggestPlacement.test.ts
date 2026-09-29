import { describe, expect, it } from "vitest";
import { SUGGEST_MENU_WIDTH, suggestMenuPlacement } from "./suggestPlacement";

describe("suggestMenuPlacement", () => {
  it("anchors under the typed input when there is room", () => {
    expect(
      suggestMenuPlacement({
        anchorLeft: 180,
        anchorBottom: 40,
        viewportWidth: 1200,
      }),
    ).toEqual({ left: 180, top: 46, width: SUGGEST_MENU_WIDTH });
  });

  it("slides left when the menu would overflow the right edge", () => {
    expect(
      suggestMenuPlacement({
        anchorLeft: 1100,
        anchorBottom: 40,
        viewportWidth: 1200,
        preferredWidth: 260,
        pad: 12,
      }),
    ).toEqual({ left: 1200 - 12 - 260, top: 46, width: 260 });
  });

  it("shrinks on a narrow viewport and keeps padding", () => {
    expect(
      suggestMenuPlacement({
        anchorLeft: 20,
        anchorBottom: 40,
        viewportWidth: 200,
        preferredWidth: 260,
        pad: 12,
      }),
    ).toEqual({ left: 12, top: 46, width: 176 });
  });

  it("does not go left of the viewport pad even when the anchor is near zero", () => {
    expect(
      suggestMenuPlacement({
        anchorLeft: 2,
        anchorBottom: 40,
        viewportWidth: 800,
        pad: 12,
      }).left,
    ).toBe(12);
  });
});
