import { motionMs, prefersReducedMotion } from "../ui/motion";

/**
 * Call `paint` whenever `data-theme` flips, and keep calling it for the
 * theme motion window so canvas strokes track lerping `@property` colors.
 */
export function subscribeThemePaint(paint: () => void): () => void {
  let raf = 0;

  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const runLerp = () => {
    stop();
    if (prefersReducedMotion()) {
      paint();
      return;
    }
    const duration = motionMs("--motion-theme");
    const start = performance.now();
    const tick = (now: number) => {
      paint();
      if (now - start < duration) {
        raf = requestAnimationFrame(tick);
      } else {
        paint();
        raf = 0;
      }
    };
    raf = requestAnimationFrame(tick);
  };

  const observer = new MutationObserver(runLerp);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    observer.disconnect();
    stop();
  };
}
