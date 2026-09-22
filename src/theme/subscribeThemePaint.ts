import { motionMs, prefersReducedMotion } from "../ui/motion";

type PaintFn = () => void;

const listeners = new Set<PaintFn>();
let observer: MutationObserver | null = null;
let raf = 0;

function stopRaf() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function paintAll() {
  for (const paint of listeners) {
    paint();
  }
}

function runLerp() {
  stopRaf();
  if (listeners.size === 0) return;
  if (prefersReducedMotion()) {
    paintAll();
    return;
  }
  const duration = motionMs("--motion-theme");
  const start = performance.now();
  /* ~30fps during lerp: enough to track CSS color motion without N×60 redraws. */
  let lastPaint = 0;
  const tick = (now: number) => {
    if (now - lastPaint >= 32) {
      paintAll();
      lastPaint = now;
    }
    if (now - start < duration) {
      raf = requestAnimationFrame(tick);
    } else {
      paintAll();
      raf = 0;
    }
  };
  raf = requestAnimationFrame(tick);
}

function ensureObserver() {
  if (observer != null || typeof document === "undefined") return;
  observer = new MutationObserver(runLerp);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/**
 * One shared observer + rAF loop for every waveform canvas. Avoids each row
 * spinning its own MutationObserver and 60fps paint during theme changes.
 */
export function subscribeThemePaint(paint: PaintFn): () => void {
  listeners.add(paint);
  ensureObserver();
  return () => {
    listeners.delete(paint);
    if (listeners.size === 0) stopRaf();
  };
}

/** Test helper: how many canvases are currently subscribed. */
export function themePaintListenerCount(): number {
  return listeners.size;
}
