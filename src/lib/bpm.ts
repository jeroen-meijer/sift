/**
 * Deriving BPM from a length and a beat count.
 *
 * A loop whose length the indexer already knows only needs one more fact to
 * give up its tempo: how many beats fit in it. `beats × 60 / seconds` is the
 * whole trick, and it beats guessing when the analyser gets the octave wrong.
 */

/** Beat counts a loop is most likely to have, in the order the menu lists them. */
export const BEAT_PRESETS = [4, 8, 16, 32] as const;

/** How close the stored BPM must sit to a preset's value to count as a match. */
const MATCH_TOLERANCE = 0.02;

/** BPM implied by `beats` beats filling `durationMs`, or null when unknowable. */
export function bpmFromBeats(
  durationMs: number | null,
  beats: number,
  round: boolean,
): number | null {
  if (durationMs == null || durationMs <= 0) return null;
  if (!Number.isFinite(beats) || beats <= 0) return null;
  const bpm = (beats * 60_000) / durationMs;
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  return round ? Math.round(bpm) : Math.round(bpm * 100) / 100;
}

/** Beats that `bpm` implies over `durationMs` — the inverse of the above. */
export function beatsFromBpm(durationMs: number | null, bpm: number | null): number | null {
  if (durationMs == null || durationMs <= 0 || bpm == null || bpm <= 0) return null;
  return (bpm * durationMs) / 60_000;
}

/** True when the sample's stored BPM is the one this beat count implies. */
export function beatsMatchBpm(
  durationMs: number | null,
  bpm: number | null,
  beats: number,
): boolean {
  const implied = beatsFromBpm(durationMs, bpm);
  return implied != null && Math.abs(implied - beats) <= beats * MATCH_TOLERANCE;
}

/**
 * The BPM a beat count gives across several samples: one number when they all
 * agree, `"varies"` when they do not, and null when none of them has a length.
 */
export function sharedBpmFromBeats(
  durations: (number | null)[],
  beats: number,
  round: boolean,
): number | "varies" | null {
  const values = durations
    .map((duration) => bpmFromBeats(duration, beats, round))
    .filter((bpm): bpm is number => bpm != null);
  const [first] = values;
  if (first == null) return null;
  return values.every((bpm) => Math.abs(bpm - first) < 0.005) ? first : "varies";
}

/** Same idea for the lengths themselves, so the panel can print one duration. */
export function sharedDuration(durations: (number | null)[]): number | "varies" | null {
  const values = durations.filter((duration): duration is number => duration != null && duration > 0);
  const [first] = values;
  if (first == null) return null;
  return values.every((duration) => Math.abs(duration - first) < 1) ? first : "varies";
}
