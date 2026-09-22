/**
 * Where a menu and its flyouts sit.
 *
 * An HTML menu cannot draw outside the window the way a native one can, so
 * every box is clamped into the viewport and made scrollable when it is taller
 * than the viewport itself.
 */

export const MENU_WIDTH = 256;
export const FLYOUT_WIDTH = 176;
export const EDGE_GAP = 8;
/** A flyout starts level with its trigger, minus the menu's own padding. */
export const FLYOUT_RISE = 5;

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  maxHeight: number;
}

export interface Box {
  left: number;
  right: number;
  top: number;
}

function clampVertically(preferredTop: number, height: number, viewport: Viewport) {
  return {
    top: Math.max(EDGE_GAP, Math.min(preferredTop, viewport.height - height - EDGE_GAP)),
    maxHeight: viewport.height - EDGE_GAP * 2,
  };
}

/** The menu itself, anchored at the pointer. */
export function placeMenu(
  x: number,
  y: number,
  height: number,
  viewport: Viewport,
  width = MENU_WIDTH,
): Placement {
  return {
    left: Math.max(EDGE_GAP, Math.min(x, viewport.width - width - EDGE_GAP)),
    ...clampVertically(y, height, viewport),
  };
}

/** True when there is no room for a flyout to the right of the menu. */
export function flyoutsGoLeft(
  menuLeft: number,
  flyoutWidth: number,
  viewport: Viewport,
): boolean {
  return menuLeft + MENU_WIDTH + flyoutWidth + EDGE_GAP > viewport.width;
}

/** A flyout, anchored to the trigger row it belongs to. */
export function placeFlyout(
  trigger: Box,
  size: { width: number; height: number },
  toLeft: boolean,
  viewport: Viewport,
): Placement {
  return {
    left: toLeft ? trigger.left - size.width : trigger.right,
    ...clampVertically(trigger.top - FLYOUT_RISE, size.height, viewport),
  };
}
