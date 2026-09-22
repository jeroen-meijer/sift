/**
 * The JS half of the motion tokens. Values live in `styles/tokens.css`; this
 * reads them so there is still only one place to retune the app's feel.
 */

const FALLBACKS: Record<string, number> = {
  "--motion-fast": 90,
  "--motion-base": 140,
  "--motion-theme": 320,
  "--motion-hover-grace": 240,
};

/** Cubic-bezier control points for WAAPI / FLIP (mirrors CSS tokens). */
export type MotionCurve = readonly [number, number, number, number];

export const MOTION_CURVES = {
  /** `--motion-ease` */
  ease: [0.2, 0, 0.13, 1] as const satisfies MotionCurve,
  /** `--motion-ease-fast-in-out` — snappy start, soft landing. */
  fastInEaseOut: [0.15, 0.85, 0.2, 1] as const satisfies MotionCurve,
} as const;

export type MotionCurveName = keyof typeof MOTION_CURVES;

const CURVE_CSS: Record<MotionCurveName, string> = {
  ease: "--motion-ease",
  fastInEaseOut: "--motion-ease-fast-in-out",
};

/** Named easing curve; falls back to the baked-in control points offline. */
export function motionCurve(name: MotionCurveName): MotionCurve {
  const fallback = MOTION_CURVES[name];
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(CURVE_CSS[name])
    .trim();
  const match =
    /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/i.exec(
      raw,
    );
  if (!match) return fallback;
  const parsed: MotionCurve = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ];
  if (parsed.some((n) => !Number.isFinite(n))) return fallback;
  return parsed;
}

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
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
