import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library's auto-cleanup never registers.
afterEach(cleanup);

// jsdom has no ResizeObserver; the virtualizer and the waveform well both want one.
globalThis.ResizeObserver = class {
  observe() {
    /* no layout in jsdom */
  }
  unobserve() {
    /* no layout in jsdom */
  }
  disconnect() {
    /* no layout in jsdom */
  }
};

/*
 * jsdom reports every box as 0 × 0, so a virtualized list renders no rows and
 * canvases have no width. Give elements a plausible size instead.
 */
const VIEWPORT = { width: 900, height: 480 };

for (const [prop, value] of [
  ["offsetWidth", VIEWPORT.width],
  ["offsetHeight", VIEWPORT.height],
  ["clientWidth", VIEWPORT.width],
  ["clientHeight", VIEWPORT.height],
] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height,
    ...VIEWPORT,
  };
  return { ...rect, toJSON: () => rect };
};
