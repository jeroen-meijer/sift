/** Theme ids, labels, and preview swatches for the Settings picker. */

export const THEMES = ["nocturne", "ink", "graphite", "snow"] as const;
export type ThemeId = (typeof THEMES)[number];

export interface ThemeInfo {
  id: ThemeId;
  /** Short line under the name in the Settings picker. */
  blurb: string;
  /** Four chips: ground, accent, text, danger. */
  swatches: [string, string, string, string];
  /** Bass / mid / treble hues for the card waveform preview (match tokens.css). */
  waveBands: {
    bass: `#${string}`;
    mid: `#${string}`;
    treble: `#${string}`;
  };
}

/**
 * Built-in palettes. Nocturne is Sift's default. Ink, Graphite, and Snow
 * follow Monospace VS Code themes.
 */
export const THEME_INFO: Record<ThemeId, ThemeInfo> = {
  nocturne: {
    id: "nocturne",
    blurb: "slate blue, low glare",
    swatches: ["#161826", "#9184d9", "#e9e9ed", "#d4837d"],
    waveBands: { bass: "#ff3d8a", mid: "#2ee89a", treble: "#8b7cff" },
  },
  ink: {
    id: "ink",
    blurb: "OLED ink, violet accent",
    swatches: ["#0b0f16", "#976fe1", "#d9dfe7", "#f57f6c"],
    waveBands: { bass: "#ff2d7b", mid: "#1dff9a", treble: "#9a7dff" },
  },
  graphite: {
    id: "graphite",
    blurb: "neutral warm grey",
    swatches: ["#121212", "#989898", "#e2e2e2", "#f57f6c"],
    waveBands: { bass: "#ff4a4a", mid: "#4ade80", treble: "#8b9cf7" },
  },
  snow: {
    id: "snow",
    blurb: "light chrome",
    swatches: ["#ffffff", "#0366d6", "#24292e", "#cb2431"],
    waveBands: { bass: "#cf222e", mid: "#1a7f37", treble: "#5b4db8" },
  },
};

/** Older installs stored `dark-default`; treat it as Nocturne. */
export function normalizeThemeId(raw: string | null | undefined): ThemeId {
  if (raw === "dark-default" || raw === "nocturne") return "nocturne";
  if (raw != null && (THEMES as readonly string[]).includes(raw)) {
    return raw as ThemeId;
  }
  return "nocturne";
}

let lerpArmed = false;

/**
 * Apply a theme. The first call snaps (startup); later calls lerp via
 * registered `@property` color tokens on `html.theme-lerp`.
 */
export function applyTheme(theme = "nocturne") {
  const id = normalizeThemeId(theme);
  const root = document.documentElement;
  if (lerpArmed && root.dataset.theme !== id) {
    root.classList.add("theme-lerp");
  } else {
    root.classList.remove("theme-lerp");
  }
  root.dataset.theme = id;
  if (!lerpArmed) {
    requestAnimationFrame(() => {
      lerpArmed = true;
    });
  }
}
