/** Theme ids and preview swatches for the Settings picker. */

export const THEMES = ["nocturne", "ink", "graphite", "snow"] as const;
export type ThemeId = (typeof THEMES)[number];

export interface ThemeInfo {
  id: ThemeId;
  /** Four chips: ground, accent, text, danger. */
  swatches: [string, string, string, string];
  /** Bass / low-mid / high-mid / treble hues for the card waveform preview. */
  waveBands: {
    bass: `#${string}`;
    lowMid: `#${string}`;
    highMid: `#${string}`;
    treble: `#${string}`;
  };
}

/**
 * Built-in palettes. Nocturne is Sift's default. Ink, Graphite, and Snow
 * follow Monospace VS Code themes. Display names and blurbs live in
 * `locales/en/settings.json` under `appearance.themes`.
 */
export const THEME_INFO: Record<ThemeId, ThemeInfo> = {
  nocturne: {
    id: "nocturne",
    swatches: ["#161826", "#9184d9", "#e9e9ed", "#d4837d"],
    waveBands: {
      bass: "#ff3d8a",
      lowMid: "#2ee89a",
      highMid: "#40c8e8",
      treble: "#8b7cff",
    },
  },
  ink: {
    id: "ink",
    swatches: ["#0b0f16", "#976fe1", "#d9dfe7", "#f57f6c"],
    waveBands: {
      bass: "#ff2d7b",
      lowMid: "#1dff9a",
      highMid: "#3ec4f0",
      treble: "#9a7dff",
    },
  },
  graphite: {
    id: "graphite",
    swatches: ["#121212", "#989898", "#e2e2e2", "#f57f6c"],
    waveBands: {
      bass: "#ff4a4a",
      lowMid: "#4ade80",
      highMid: "#38bdf8",
      treble: "#8b9cf7",
    },
  },
  snow: {
    id: "snow",
    swatches: ["#ffffff", "#0366d6", "#24292e", "#cb2431"],
    waveBands: {
      bass: "#cf222e",
      lowMid: "#1a7f37",
      highMid: "#0969da",
      treble: "#5b4db8",
    },
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
