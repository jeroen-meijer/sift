import type { WaveLanePeaks } from "./drawWaveform";

const PREVIEW_BUCKETS = 128;

/** Deterministic 0..1 hash for mottling without Math.random. */
function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Synthetic lane shaped like a neuro/bass one-shot: bright transient, pink
 * bass+treble body, then a treble tail. Weights overlap the way real moodbar
 * frames do (not a clean left→right rainbow).
 */
export function buildThemePreviewLane(): WaveLanePeaks {
  const peaks: number[] = [];
  const colors: number[] = [];
  const last = PREVIEW_BUCKETS - 1;

  for (let i = 0; i < PREVIEW_BUCKETS; i++) {
    const t = i / last;
    const n = hash01(i);

    const amp = Math.min(
      1,
      0.95 * Math.exp(-(((t - 0.06) / 0.035) ** 2)) +
        0.82 * Math.exp(-(((t - 0.28) / 0.14) ** 2)) +
        0.55 * Math.exp(-(((t - 0.52) / 0.12) ** 2)) +
        0.32 * Math.exp(-(((t - 0.78) / 0.14) ** 2)) +
        0.12 * Math.exp(-(((t - 0.94) / 0.08) ** 2)),
    );
    const jagged = amp * (0.82 + 0.18 * n);
    peaks.push(-jagged, jagged);

    /* Soft region mix (not hard cuts) so colors mottled like real moodbar. */
    const wHit = Math.exp(-(((t - 0.05) / 0.04) ** 2));
    const wBody = Math.exp(-(((t - 0.3) / 0.16) ** 2));
    const wGrowl = Math.exp(-(((t - 0.55) / 0.12) ** 2));
    const wTail = Math.exp(-(((t - 0.85) / 0.14) ** 2));
    const wSum = wHit + wBody + wGrowl + wTail || 1;

    let bass =
      (0.75 * wHit + 0.95 * wBody + 0.7 * wGrowl + 0.12 * wTail) / wSum;
    let lowMid =
      (0.4 * wHit + 0.22 * wBody + 0.55 * wGrowl + 0.2 * wTail) / wSum;
    let highMid =
      (0.45 * wHit + 0.12 * wBody + 0.55 * wGrowl + 0.35 * wTail) / wSum;
    let treble =
      (0.95 * wHit + 0.7 * wBody + 0.28 * wGrowl + 0.92 * wTail) / wSum;

    bass = Math.min(1, Math.max(0, bass + (n - 0.5) * 0.22));
    lowMid = Math.min(1, Math.max(0, lowMid + (hash01(i + 17) - 0.5) * 0.18));
    highMid = Math.min(1, Math.max(0, highMid + (hash01(i + 29) - 0.5) * 0.16));
    treble = Math.min(1, Math.max(0, treble + (hash01(i + 41) - 0.5) * 0.2));

    const sum = bass + lowMid + highMid + treble || 1;
    colors.push(
      Math.round((bass / sum) * 255),
      Math.round((lowMid / sum) * 255),
      Math.round((highMid / sum) * 255),
      Math.round((treble / sum) * 255),
    );
  }

  return { peaks, colors, bucketCount: PREVIEW_BUCKETS, channels: 1 };
}
