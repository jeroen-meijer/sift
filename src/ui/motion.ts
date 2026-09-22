/**
 * The JS half of the motion tokens. Values live in `styles/tokens.css`; this
 * reads them so there is still only one place to retune the app's feel.
 */

const FALLBACKS: Record<string, number> = {
  "--motion-fast": 90,
  "--motion-base": 140,
  "--motion-hover-grace": 240,
};

/** A `--motion-*` duration token in milliseconds. */
export function motionMs(token: keyof typeof FALLBACKS): number {
  const fallback = FALLBACKS[token] ?? 0;
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (raw.endsWith("ms")) {
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) return value;
  }
  if (raw.endsWith("s")) {
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) return value * 1000;
  }
  return fallback;
}

/** True when the viewer asked the system to keep animation to a minimum. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
