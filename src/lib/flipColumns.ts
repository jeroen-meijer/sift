/**
 * FLIP translateX on column cells. Never touches the row's translateY
 * (owned by the virtualizer).
 */

import { motionCurve, motionMs, prefersReducedMotion } from "../ui/motion";
import type { ResizableColumn } from "./columnWidths";

export type ColRectMap = Map<ResizableColumn, { left: number; right: number }>;

/** Measure left/right of each `[data-col]` under a root (header or body). */
export function measureColRects(root: ParentNode): ColRectMap {
  const map: ColRectMap = new Map();
  const nodes = root.querySelectorAll<HTMLElement>("[data-col]");
  for (const el of nodes) {
    const id = el.dataset.col as ResizableColumn | undefined;
    if (!id || map.has(id)) continue;
    const rect = el.getBoundingClientRect();
    map.set(id, { left: rect.left, right: rect.right });
  }
  return map;
}

/** Measure every `[data-col]` left (including duplicates across rows). */
export function measureAllColLefts(root: ParentNode): Map<HTMLElement, number> {
  const map = new Map<HTMLElement, number>();
  const nodes = root.querySelectorAll<HTMLElement>("[data-col]");
  for (const el of nodes) {
    map.set(el, el.getBoundingClientRect().left);
  }
  return map;
}

let activeAnims: Animation[] = [];

/** Cancel any in-flight column FLIP animations. */
export function cancelColumnFlip(): void {
  for (const anim of activeAnims) {
    anim.cancel();
  }
  activeAnims = [];
}

/**
 * After the DOM has updated to the new column order, invert from `before`
 * lefts and play to identity with fastInEaseOut.
 */
export function playColumnFlip(
  _root: ParentNode,
  before: Map<HTMLElement, number>,
): void {
  if (prefersReducedMotion() || before.size === 0) return;
  if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") {
    return;
  }

  cancelColumnFlip();
  const duration = motionMs("--motion-base");
  const easing = `cubic-bezier(${motionCurve("fastInEaseOut").join(",")})`;
  const nextAnims: Animation[] = [];

  for (const [el, prevLeft] of before) {
    if (!el.isConnected) continue;
    const nextLeft = el.getBoundingClientRect().left;
    const dx = prevLeft - nextLeft;
    if (Math.abs(dx) < 0.5) continue;
    el.style.transform = `translateX(${String(dx)}px)`;
    const anim = el.animate(
      [{ transform: `translateX(${String(dx)}px)` }, { transform: "translateX(0px)" }],
      { duration, easing, fill: "none" },
    );
    anim.addEventListener("finish", () => {
      el.style.transform = "";
    });
    anim.addEventListener("cancel", () => {
      el.style.transform = "";
    });
    nextAnims.push(anim);
  }
  activeAnims = nextAnims;
}
