/** Frontend profiling helpers, gated by Rust `SIFT_PROFILE=1`.
 *
 * Marks are fire-and-forget (batched) so they do not serialize the IPC queue
 * the way an awaited `profile_mark` after every `get_peaks` did.
 *
 * Boot timeline: [`bootMark`] uses ms since this module first evaluated
 * (`boot.fe.*`). Pair with Rust `boot.*` milestones in the same log file.
 */

import { invoke } from "@tauri-apps/api/core";
import { useLayoutEffect } from "react";

let enabled: boolean | null = null;

/** Approx. FE script start (`performance.now()` at first import). */
const feEpoch = performance.now();

interface PendingMark {
  name: string;
  ms: number;
  detail: string | null;
}

const buffer: PendingMark[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let observersStarted = false;
let rafId = 0;
let navLogged = false;

/** True when the Rust side was started with `SIFT_PROFILE=1`. */
export async function profileEnabled(): Promise<boolean> {
  if (enabled != null) return enabled;
  try {
    enabled = await invoke<boolean>("profile_enabled");
  } catch {
    enabled = false;
  }
  if (enabled) flushBuffer();
  else buffer.length = 0;
  return enabled;
}

/** Sync read after {@link warmProfile} / first async check. */
export function isProfileOn(): boolean {
  return enabled === true;
}

/** Resolve enabled flag and start frame / longtask observers. Call once from App. */
export async function warmProfile(): Promise<boolean> {
  const on = await profileEnabled();
  if (on) {
    startFeProfilers();
    logBootNavigation();
  }
  return on;
}

/**
 * Startup milestone: `ms` is elapsed since FE module load.
 * Names should be `boot.fe.*` (or pass a short suffix; `boot.` is prefixed when missing).
 */
export function bootMark(name: string, detail?: string): void {
  const full = name.startsWith("boot.") ? name : `boot.${name}`;
  enqueueMark(full, performance.now() - feEpoch, detail);
}

/** Time one async boot step (duration of the step, not since epoch). */
export async function bootProfiled<T>(
  name: string,
  detail: string,
  run: () => Promise<T>,
): Promise<T> {
  const full = name.startsWith("boot.") ? name : `boot.${name}`;
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    enqueueMark(full, performance.now() - t0, detail);
  }
}

function logBootNavigation(): void {
  if (navLogged) return;
  navLogged = true;
  try {
    const entries = performance.getEntriesByType("navigation");
    const nav = entries[0];
    if (!(nav instanceof PerformanceNavigationTiming)) return;
    /* Values are already ms since timeOrigin (= page start in the webview). */
    enqueueMark("boot.fe.nav_response", nav.responseEnd, `transfer=${String(nav.transferSize)}`);
    enqueueMark("boot.fe.nav_dom_interactive", nav.domInteractive, "");
    enqueueMark("boot.fe.nav_dom_content", nav.domContentLoadedEventEnd, "");
    enqueueMark("boot.fe.nav_load", nav.loadEventEnd, "");
  } catch {
    /* ignore */
  }
}

function enqueueMark(name: string, ms: number, detail?: string): void {
  if (enabled === false) return;
  buffer.push({ name, ms, detail: detail ?? null });
  if (enabled === null) {
    void profileEnabled();
    return;
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    flushBuffer();
  }, 32);
}

function flushBuffer(): void {
  if (enabled !== true || buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  void invoke("profile_mark_batch", { marks: batch }).catch(() => {
    /* ignore */
  });
}

/** Append a timed mark (non-blocking). */
export function profileMark(name: string, ms: number, detail?: string): void {
  enqueueMark(name, ms, detail);
}

/** Instant event with 0 ms duration. */
export function profileEvent(name: string, detail?: string): void {
  enqueueMark(name, 0, detail);
}

/** Time a sync body. */
export function measureSync<T>(name: string, detail: string, run: () => T): T {
  if (enabled === false) return run();
  const t0 = performance.now();
  try {
    return run();
  } finally {
    enqueueMark(name, performance.now() - t0, detail);
  }
}

/** Time an async FE call. Mark is fire-and-forget (does not await IPC). */
export async function profiled<T>(
  name: string,
  detail: string,
  run: () => Promise<T>,
): Promise<T> {
  const on = await profileEnabled();
  if (!on) return run();
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    enqueueMark(name, performance.now() - t0, detail);
  }
}

/**
 * rAF hitch loop + longtask observer. No-ops when profiling is off.
 * Safe to call more than once.
 */
export function startFeProfilers(): void {
  if (observersStarted || enabled !== true) return;
  observersStarted = true;

  let last = performance.now();
  let frames = 0;
  let sumDt = 0;
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    frames += 1;
    sumDt += dt;
    /* Log every hitch over ~1.5 frames at 60Hz, and a 1Hz fps summary. */
    if (dt >= 25) {
      enqueueMark("fe.frame", dt, `hitch frames=${String(frames)}`);
    }
    if (sumDt >= 1000) {
      const fps = (frames * 1000) / sumDt;
      enqueueMark("fe.fps", fps, `frames=${String(frames)} window_ms=${sumDt.toFixed(0)}`);
      frames = 0;
      sumDt = 0;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        enqueueMark("fe.longtask", entry.duration, entry.name || "longtask");
      }
    });
    obs.observe({ type: "longtask", buffered: true });
  } catch {
    enqueueMark("fe.longtask_unsupported", 0, "PerformanceObserver longtask missing");
  }

  enqueueMark("fe.profilers_start", 0, "raf+longtask");
}

/** Test / shutdown helper. */
export function __stopFeProfilersForTests(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  observersStarted = false;
  navLogged = false;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  buffer.length = 0;
  enabled = null;
}

/** Renders shorter than this are not logged. */
const RENDER_MARK_MIN_MS = 4;

/**
 * `fe.render` mark: time from this component's render body to its layout
 * effect, which covers the render and commit of its whole subtree. Works in
 * release builds, where React's `<Profiler>` reports nothing. Memoized
 * components that skip rendering log nothing.
 */
export function useRenderTiming(id: string): void {
  // Profile builds only: the render start time is the thing being measured.
  // eslint-disable-next-line react-hooks/purity
  const t0 = enabled === true ? performance.now() : 0;
  useLayoutEffect(() => {
    if (t0 === 0) return;
    const ms = performance.now() - t0;
    if (ms >= RENDER_MARK_MIN_MS) enqueueMark("fe.render", ms, `id=${id}`);
  });
}
