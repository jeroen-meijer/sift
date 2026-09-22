/** Display formatting. Everything the design prints in mono lives here. */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** `3.1 MB`, `412 MB`, `0 B`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exp = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const unit = UNITS[exp] ?? "B";
  const value = bytes / 1024 ** exp;
  return `${value < 10 && exp > 0 ? value.toFixed(1) : Math.round(value).toString()} ${unit}`;
}

/** `0:04.36`. The ruler and the selection pill both use this. */
export function formatTime(secs: number): string {
  const safe = Number.isFinite(secs) && secs > 0 ? secs : 0;
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/** `−4.5 dB` with a real minus sign, the way the design prints it. */
export function formatDb(db: number): string {
  if (db > 0) return `+${db.toFixed(1)} dB`;
  if (db < 0) return `−${Math.abs(db).toFixed(1)} dB`;
  return "0.0 dB";
}

/** `4,402`. Thousands separators for every count in the chrome. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Beats between two times at `bpm`, or null when the sample has no BPM. */
export function beatsBetween(startSecs: number, endSecs: number, bpm: number | null): number | null {
  if (bpm == null || bpm <= 0) return null;
  return ((endSecs - startSecs) * bpm) / 60;
}

/** `2 bars`, `3 beats`, or null when the sample has no BPM. */
export function formatSpan(startSecs: number, endSecs: number, bpm: number | null): string | null {
  const beats = beatsBetween(startSecs, endSecs, bpm);
  if (beats == null) return null;
  const bars = beats / 4;
  if (bars >= 1) {
    const rounded = Math.round(bars * 100) / 100;
    return `${rounded} ${rounded === 1 ? "bar" : "bars"}`;
  }
  const rounded = Math.round(beats * 100) / 100;
  return `${rounded} ${rounded === 1 ? "beat" : "beats"}`;
}
