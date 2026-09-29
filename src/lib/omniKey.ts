/**
 * Omni key helpers: NOTES spellings, Camelot, parse/format for the key chip.
 * Analyzer still stores `Am` / `F#`; display uses NOTES (`Eb`, `Ab`, …).
 */

import type { OmniKey } from "./omni";

/** Display note names for pitch classes 0–11. */
export const NOTES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export type NoteName = (typeof NOTES)[number];

/** Accidentals shown on the piano picker (both spellings). */
export const ACCIDENTAL_LABELS: { pc: number; label: string; sub: string }[] = [
  { pc: 1, label: "C#", sub: "Db" },
  { pc: 3, label: "D#", sub: "Eb" },
  { pc: 6, label: "F#", sub: "Gb" },
  { pc: 8, label: "G#", sub: "Ab" },
  { pc: 10, label: "A#", sub: "Bb" },
];

/** 14-col grid: accidentals start at 2, 4, 8, 10, 12 and each spans 2 (same as naturals). */
export const ACCIDENTAL_COLS = [2, 4, 8, 10, 12] as const;

const ROOT_TO_PC: Record<string, number> = {
  c: 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  fb: 4,
  f: 5,
  "e#": 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
  cb: 11,
  "b#": 0,
};

const MAJ_SUFFIXES = ["major", "maj", "ma"] as const;
const MIN_SUFFIXES = ["minor", "min", "mi"] as const;

function compact(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replaceAll("♯", "#")
    .replaceAll("♭", "b")
    .replaceAll(/\s+/g, "");
}

/** Relative major/minor pitch class (±3). */
export function relativePitchClass(pc: number, mode: "maj" | "min"): number {
  return mode === "min" ? (pc + 3) % 12 : (pc + 9) % 12;
}

/**
 * Camelot: minor `nA` → `(8 + 7(n−1)) mod 12`;
 * major `nB` → `(11 + 7(n−1)) mod 12`.
 */
export function camelotToOmniKey(num: number, letter: "a" | "b"): OmniKey | null {
  if (num < 1 || num > 12) return null;
  if (letter === "a") {
    return { pitchClass: (8 + 7 * (num - 1)) % 12, mode: "min" };
  }
  return { pitchClass: (11 + 7 * (num - 1)) % 12, mode: "maj" };
}

export function camelotLabel(key: OmniKey): string | null {
  if (key.mode === "either") return null;
  for (let n = 1; n <= 12; n++) {
    const candidate = camelotToOmniKey(n, key.mode === "min" ? "a" : "b");
    if (candidate?.pitchClass === key.pitchClass) {
      return `${String(n)}${key.mode === "min" ? "A" : "B"}`;
    }
  }
  return null;
}

export function noteName(pc: number): NoteName {
  const n = NOTES[((pc % 12) + 12) % 12];
  return n ?? "C";
}

/** Chip / picker label: `A maj`, `A min`, or `A` for either. Camelot stays parse-only. */
export function formatOmniKey(key: OmniKey): string {
  const root = noteName(key.pitchClass);
  if (key.mode === "either") return root;
  return `${root} ${key.mode === "maj" ? "maj" : "min"}`;
}

/** Analyzer-compatible stored value: `A`, `Am`. Either → root only. */
export function omniKeyToStored(key: OmniKey): string {
  const root = noteName(key.pitchClass);
  if (key.mode === "min") return `${root}m`;
  return root;
}

/** Canonical typed token body after `k:` (no prefix). */
export function serializeOmniKeyBody(key: OmniKey): string {
  const root = noteName(key.pitchClass).toLowerCase();
  if (key.mode === "either") return root;
  if (key.mode === "min") return `${root}m`;
  return `${root}maj`;
}

/**
 * Parse free-form key text into OmniKey.
 * Accepts root (`a`, `f#`, `bb`), mode suffixes, and Camelot `1a`–`12b`.
 * Root without mode → `either`.
 */
export function parseOmniKey(raw: string): OmniKey | null {
  const token = compact(raw);
  if (!token) return null;

  const camelot = /^(\d{1,2})([ab])$/i.exec(token);
  if (camelot) {
    const num = Number(camelot[1]);
    const letter = (camelot[2] ?? "a").toLowerCase() as "a" | "b";
    return camelotToOmniKey(num, letter);
  }

  for (const suffix of MAJ_SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      const root = token.slice(0, -suffix.length);
      const pc = ROOT_TO_PC[root];
      if (pc == null) return null;
      return { pitchClass: pc, mode: "maj" };
    }
  }
  for (const suffix of MIN_SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      const root = token.slice(0, -suffix.length);
      const pc = ROOT_TO_PC[root];
      if (pc == null) return null;
      return { pitchClass: pc, mode: "min" };
    }
  }
  if (/^[a-g][#b]?m$/i.test(token)) {
    const root = token.slice(0, -1);
    const pc = ROOT_TO_PC[root];
    if (pc == null) return null;
    return { pitchClass: pc, mode: "min" };
  }

  const pc = ROOT_TO_PC[token];
  if (pc == null) return null;
  return { pitchClass: pc, mode: "either" };
}

/** Parse a stored analyzer key (`Am`, `F#`) into OmniKey with explicit mode. */
export function storedKeyToOmni(stored: string): OmniKey | null {
  const token = compact(stored);
  if (!token) return null;
  if (token.endsWith("m") && token.length > 1) {
    const pc = ROOT_TO_PC[token.slice(0, -1)];
    if (pc == null) return null;
    return { pitchClass: pc, mode: "min" };
  }
  const pc = ROOT_TO_PC[token];
  if (pc == null) return null;
  return { pitchClass: pc, mode: "maj" };
}

/** Relative key label for the toggle, e.g. `F# min`. */
export function relativeKeyLabel(key: OmniKey): string | null {
  if (key.mode === "either") return null;
  const pc = relativePitchClass(key.pitchClass, key.mode);
  const mode = key.mode === "maj" ? "min" : "maj";
  return `${noteName(pc)} ${mode}`;
}
