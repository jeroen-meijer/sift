/**
 * Tag chip colours. The design paints a chip from the root segment of the tag
 * path (`Drums/Kick` → the Drums palette). A colour set by hand in the tag
 * editor wins over that, and anything unknown falls back to neutral.
 *
 * Root palettes live in theme tokens (`--color-tag-*-{bg,fg,dot}`). Custom
 * stored hex colours still build a chip in JS from the theme mix ground.
 */

export interface TagColors {
  bg: string;
  fg: string;
  dot: string;
}

export interface TagSwatchChoice {
  /** CSS value for the swatch preview. */
  css: string;
  /** Resolved `#rrggbb` to store when the user picks this swatch. */
  storedHex: string | null;
}

/** Ordered theme token slugs for the editor swatch row. */
export const TAG_SWATCH_KEYS = [
  "drums",
  "synths",
  "fx",
  "field",
  "ambience",
  "vocals",
  "genre",
] as const;

export type TagSwatchKey = (typeof TAG_SWATCH_KEYS)[number];

/** Root segment display name → theme token slug. */
const ROOT_SLUG: Record<string, TagSwatchKey> = {
  Drums: "drums",
  Synths: "synths",
  FX: "fx",
  Field: "field",
  Ambience: "ambience",
  Vocals: "vocals",
  Genre: "genre",
};

const FALLBACK_SLUG = "fallback";

function tokenPalette(slug: string): TagColors {
  return {
    bg: `var(--color-tag-${slug}-bg)`,
    fg: `var(--color-tag-${slug}-fg)`,
    dot: `var(--color-tag-${slug}-dot)`,
  };
}

/** Dot CSS vars for the tag-editor swatch row (display only). */
export const TAG_SWATCHES = TAG_SWATCH_KEYS.map((key) => tokenPalette(key).dot);

const HEX = /^#([0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;

function parseHex(hex: string): [number, number, number] | null {
  const match = HEX.exec(hex.trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: readonly number[], b: readonly number[], amount: number): number[] {
  return a.map((channel, i) => channel + ((b[i] ?? 0) - channel) * amount);
}

function mixGround(): [number, number, number] {
  if (typeof document !== "undefined") {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-tag-mix-ground")
      .trim();
    const hex = parseHex(raw);
    if (hex) return hex;
    const resolved = resolveCssColorToHex(raw);
    if (resolved) {
      const fromResolved = parseHex(resolved);
      if (fromResolved) return fromResolved;
    }
  }
  return [0x1b, 0x1d, 0x2b];
}

/** Resolve a CSS color (including `var(--…)`) to `#rrggbb` for storage / compare. */
export function resolveCssColorToHex(cssColor: string): string | null {
  const asHex = parseHex(cssColor);
  if (asHex) return toHex(asHex);
  if (typeof document === "undefined") return null;
  const el = document.createElement("span");
  el.style.color = cssColor;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();
  const match = RGB.exec(computed);
  if (!match) return null;
  return toHex([Number(match[1]), Number(match[2]), Number(match[3])]);
}

/** Swatch row choices: preview CSS + hex to persist when clicked. */
export function tagSwatchChoices(): TagSwatchChoice[] {
  return TAG_SWATCH_KEYS.map((key) => {
    const css = tokenPalette(key).dot;
    return { css, storedHex: resolveCssColorToHex(css) };
  });
}

/** Build a design-shaped chip (dark ground, light ink) from one hex colour. */
function paletteFromHex(hex: string): TagColors | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const ground = mixGround();
  return {
    bg: toHex(mix(ground, rgb, 0.34)),
    fg: toHex(mix(rgb, [255, 255, 255], 0.62)),
    dot: toHex(rgb),
  };
}

export function tagPalette(path: string, storedColor?: string | null): TagColors {
  if (storedColor) {
    const custom = paletteFromHex(storedColor);
    if (custom) return custom;
  }
  const root = path.split("/")[0] ?? "";
  return tokenPalette(ROOT_SLUG[root] ?? FALLBACK_SLUG);
}
