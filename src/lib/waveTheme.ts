import { readSpectralBandsFrom, type SpectralBandColors } from "./spectralColor";

export interface WaveTheme {
  ink: string;
  inkSelected: string;
  bands: SpectralBandColors;
}

let cached: WaveTheme | null = null;

/**
 * Row waveform colors, read once per theme change instead of two
 * `getComputedStyle` calls per row paint. The vars live on `:root`.
 */
export function waveTheme(): WaveTheme {
  if (cached) return cached;
  const styles = getComputedStyle(document.documentElement);
  cached = {
    ink: styles.getPropertyValue("--color-row-wave").trim() || "#6a6d80",
    inkSelected: styles.getPropertyValue("--color-row-wave-sel").trim() || "#b9b0f0",
    bands: readSpectralBandsFrom(styles),
  };
  return cached;
}

/** Call when theme colors change (the theme lerp calls it every tick). */
export function invalidateWaveTheme(): void {
  cached = null;
}
