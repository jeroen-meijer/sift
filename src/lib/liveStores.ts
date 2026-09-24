import { useLayoutEffect, type RefObject } from "react";
import { createStore } from "./store";

export interface AnalysisBar {
  done: number;
  /** When 0, the bar is indeterminate (spinner + count only). */
  total: number;
}

export interface AnalysisLive {
  bar: AnalysisBar | null;
  /** Samples a worker is analyzing right now (not the whole queue). */
  activeIds: ReadonlySet<number>;
}

export const analysisStore = createStore<AnalysisLive>({ bar: null, activeIds: new Set() });

/**
 * Rows whose fields changed on the backend (analysis finished, availability
 * flipped). `LibraryView` patches the matching rows; `seq` makes repeat ids
 * count as a new change.
 */
export const rowChangesStore = createStore<{ seq: number; ids: readonly number[] }>({
  seq: 0,
  ids: [],
});

/** Seconds into the playing sample, or null. Written every animation frame. */
export const playheadStore = createStore<number | null>(null);

/**
 * Move a full-width overlay to the playhead by writing `transform` directly,
 * so the playhead never causes a React render.
 *
 * `mode: "translate"` shifts the element right by the played fraction (put a
 * line at its left edge). `mode: "scale"` scales it from the left (a played fill).
 */
export function usePlayheadStyle(
  ref: RefObject<HTMLElement | null>,
  durationSecs: number,
  active: boolean,
  mode: "translate" | "scale" = "translate",
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!active || durationSecs <= 0) {
      el.style.visibility = "hidden";
      return;
    }
    const apply = () => {
      const secs = playheadStore.get();
      if (secs == null) {
        el.style.visibility = "hidden";
        return;
      }
      const f = Math.min(1, Math.max(0, secs / durationSecs));
      el.style.visibility = "visible";
      el.style.transform =
        mode === "translate" ? `translateX(${(f * 100).toFixed(3)}%)` : `scaleX(${f.toFixed(4)})`;
    };
    apply();
    return playheadStore.subscribe(apply);
  }, [ref, durationSecs, active, mode]);
}
