import { describe, expect, it } from "vitest";
import {
  EDGE_GAP,
  FLYOUT_WIDTH,
  MENU_WIDTH,
  flyoutsGoLeft,
  placeFlyout,
  placeMenu,
  type Viewport,
} from "./menuPlacement";

const VIEWPORT: Viewport = { width: 1440, height: 900 };

/** An HTML menu is trapped inside the window, so nothing may stick out. */
function fitsInside(
  box: { left: number; top: number },
  size: { width: number; height: number },
  viewport: Viewport,
): boolean {
  return (
    box.left >= 0 &&
    box.top >= 0 &&
    box.left + size.width <= viewport.width &&
    box.top + Math.min(size.height, viewport.height) <= viewport.height
  );
}

describe("placeMenu", () => {
  it("sits at the pointer when there is room", () => {
    expect(placeMenu(300, 200, 400, VIEWPORT)).toMatchObject({ left: 300, top: 200 });
  });

  it("pulls back from the right and bottom edges", () => {
    const placed = placeMenu(1400, 800, 400, VIEWPORT);
    expect(placed.left).toBe(VIEWPORT.width - MENU_WIDTH - EDGE_GAP);
    expect(placed.top).toBe(VIEWPORT.height - 400 - EDGE_GAP);
    expect(fitsInside(placed, { width: MENU_WIDTH, height: 400 }, VIEWPORT)).toBe(true);
  });

  it("keeps a gap at the top and left for a pointer at the origin", () => {
    expect(placeMenu(0, 0, 400, VIEWPORT)).toMatchObject({ left: EDGE_GAP, top: EDGE_GAP });
  });

  it("scrolls when taller than the window", () => {
    const short: Viewport = { width: 1440, height: 240 };
    const placed = placeMenu(100, 100, 600, short);
    expect(placed.top).toBe(EDGE_GAP);
    expect(placed.maxHeight).toBe(short.height - EDGE_GAP * 2);
  });
});

describe("flyoutsGoLeft", () => {
  it("stays on the right while the flyout fits", () => {
    expect(flyoutsGoLeft(300, FLYOUT_WIDTH, VIEWPORT)).toBe(false);
  });

  it("flips once the flyout would leave the window", () => {
    expect(flyoutsGoLeft(1100, 244, VIEWPORT)).toBe(true);
  });
});

describe("placeFlyout", () => {
  const trigger = { left: 300, right: 550, top: 400 };
  const size = { width: 244, height: 268 };

  it("opens beside its trigger, level with it", () => {
    expect(placeFlyout(trigger, size, false, VIEWPORT)).toMatchObject({
      left: trigger.right,
      top: trigger.top - 5,
    });
  });

  it("opens on the other side when flipped", () => {
    expect(placeFlyout(trigger, size, true, VIEWPORT).left).toBe(trigger.left - size.width);
  });

  // The bug this module exists for: a flyout used to inherit its trigger's
  // vertical position and run straight off the bottom of the window.
  it("rides up so a tall flyout near the bottom stays in the window", () => {
    const low = { left: 120, right: 376, top: 330 };
    const viewport: Viewport = { width: 900, height: 560 };
    const placed = placeFlyout(low, size, false, viewport);
    expect(placed.top).toBeLessThan(low.top);
    expect(fitsInside(placed, size, viewport)).toBe(true);
  });

  it("scrolls when the window is shorter than the flyout", () => {
    const viewport: Viewport = { width: 900, height: 240 };
    const placed = placeFlyout(trigger, size, false, viewport);
    expect(placed.top).toBe(EDGE_GAP);
    expect(placed.maxHeight).toBe(viewport.height - EDGE_GAP * 2);
  });
});
