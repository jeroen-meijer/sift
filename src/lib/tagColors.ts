/**
 * Tag chip colours. The design paints a chip from the root segment of the tag
 * path (`Drums/Kick` → the Drums palette). A colour set by hand in the tag
 * editor wins over that, and anything unknown falls back to neutral.
 */
export interface TagColors {
  bg: string;
  fg: string;
  dot: string;
}

const ROOT_PALETTE: Record<string, TagColors> = {
  Drums: { bg: "#39305a", fg: "#cdc4f5", dot: "#8a7ad0" },
  Synths: { bg: "#1f3a45", fg: "#bfe3ef", dot: "#5f8fa8" },
  FX: { bg: "#453721", fg: "#f1ddba", dot: "#a88a5f" },
  Field: { bg: "#26402f", fg: "#c4e4ce", dot: "#5f9a72" },
  Ambience: { bg: "#2b3348", fg: "#c7d3ec", dot: "#7f849b" },
  Vocals: { bg: "#452a38", fg: "#f1cadb", dot: "#a86b80" },
  Genre: { bg: "#322b56", fg: "#d2caf6", dot: "#6d78b8" },
};

const FALLBACK: TagColors = { bg: "#31333d", fg: "#cfd3e5", dot: "#75798c" };

/** The swatches the tag editor offers, in design order. */
export const TAG_SWATCHES = Object.values(ROOT_PALETTE).map((entry) => entry.dot);

const GROUND = [0x1b, 0x1d, 0x2b] as const;
const HEX = /^#([0-9a-f]{6})$/i;

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

/** Build a design-shaped chip (dark ground, light ink) from one hex colour. */
function paletteFromHex(hex: string): TagColors | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return {
    bg: toHex(mix(GROUND, rgb, 0.34)),
    fg: toHex(mix(rgb, [255, 255, 255], 0.62)),
    dot: toHex(rgb),
  };
}

export function tagPalette(path: string, storedColor?: string | null): TagColors {
  if (storedColor) {
    const custom = paletteFromHex(storedColor);
    if (custom) return custom;
  }
  return ROOT_PALETTE[path.split("/")[0] ?? ""] ?? FALLBACK;
}
