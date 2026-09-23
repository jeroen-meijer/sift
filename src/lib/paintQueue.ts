/**
 * Row canvas painting with a time budget.
 *
 * `paintNow` paints in the caller's frame (call it from a layout effect, so
 * the result is on screen in the same frame) until this frame's budget is
 * spent. Past that, paints wait for the next animation frames, again with a
 * budget, so a fast flick never stalls scrolling.
 */
const queue = new Map<HTMLCanvasElement, () => void>();
let raf = 0;
/** Deferred paints per animation frame. */
const QUEUE_BUDGET_MS = 6;
/** Immediate paints per ~frame (row paints cost ~0.2 to 1 ms each). */
const IMMEDIATE_BUDGET_MS = 10;
const FRAME_MS = 16;

let windowStart = 0;
let windowSpent = 0;

export function schedulePaint(canvas: HTMLCanvasElement, paint: () => void): void {
  queue.set(canvas, paint); // the latest paint for a canvas wins
  if (raf === 0) raf = requestAnimationFrame(flush);
}

/**
 * Paint right away if this frame still has budget, else queue it.
 * Returns true when it painted now.
 */
export function paintNow(canvas: HTMLCanvasElement, paint: () => void): boolean {
  const start = performance.now();
  if (start - windowStart > FRAME_MS) {
    windowStart = start;
    windowSpent = 0;
  }
  if (windowSpent >= IMMEDIATE_BUDGET_MS) {
    schedulePaint(canvas, paint);
    return false;
  }
  queue.delete(canvas);
  paint();
  windowSpent += performance.now() - start;
  return true;
}

export function cancelPaint(canvas: HTMLCanvasElement): void {
  queue.delete(canvas);
}

function flush(): void {
  raf = 0;
  const deadline = performance.now() + QUEUE_BUDGET_MS;
  for (const [canvas, paint] of queue) {
    queue.delete(canvas);
    paint();
    if (performance.now() > deadline) break;
  }
  if (queue.size > 0) raf = requestAnimationFrame(flush);
}

/** Test helper. */
export function __resetPaintQueueForTests(): void {
  queue.clear();
  if (raf !== 0) cancelAnimationFrame(raf);
  raf = 0;
  windowStart = 0;
  windowSpent = 0;
}
