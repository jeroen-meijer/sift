/**
 * Match badges for table cells when half/double or relative expand the hit set.
 */

import type { OmniKey } from "./omni";
import { noteName, relativePitchClass } from "./omniKey";
import { normalizeKeyToken } from "./keys";

export type BpmBadge = "×2" | "÷2" | null;

/** Which half/double band matched, or null if direct / no match / toggle off. */
export function bpmMatchBadge(
  sampleBpm: number | null | undefined,
  min: number | null,
  max: number | null,
  halfDouble: boolean,
): BpmBadge {
  if (sampleBpm == null || !halfDouble || (min == null && max == null)) return null;
  const lo = min ?? 0;
  const hi = max ?? Number.POSITIVE_INFINITY;
  const direct = sampleBpm >= lo && sampleBpm <= hi;
  if (direct) return null;
  const half = sampleBpm >= lo / 2 && sampleBpm <= hi / 2;
  if (half) return "÷2";
  const dbl = sampleBpm >= lo * 2 && sampleBpm <= hi * 2;
  if (dbl) return "×2";
  return null;
}

function enharmonicRoots(pc: number): string[] {
  const map: Record<number, string[]> = {
    0: ["c", "b#"],
    1: ["c#", "db"],
    2: ["d"],
    3: ["d#", "eb"],
    4: ["e", "fb"],
    5: ["f", "e#"],
    6: ["f#", "gb"],
    7: ["g"],
    8: ["g#", "ab"],
    9: ["a"],
    10: ["a#", "bb"],
    11: ["b", "cb"],
  };
  return map[pc] ?? [noteName(pc).toLowerCase()];
}

function tokensFor(key: OmniKey, relative: boolean): Set<string> {
  const out = new Set<string>();
  const pushPc = (pc: number, mode: "maj" | "min" | "either") => {
    for (const root of enharmonicRoots(pc)) {
      if (mode === "either" || mode === "maj") out.add(root);
      if (mode === "either" || mode === "min") out.add(`${root}m`);
    }
  };
  pushPc(key.pitchClass, key.mode);
  if (relative && key.mode !== "either") {
    const relPc = relativePitchClass(key.pitchClass, key.mode);
    pushPc(relPc, key.mode === "maj" ? "min" : "maj");
  }
  return out;
}

/** True when the sample key matches only via the relative, not the primary. */
export function keyMatchIsRelativeOnly(
  sampleKey: string | null | undefined,
  filter: OmniKey | null,
  relative: boolean,
): boolean {
  if (!sampleKey || !filter || !relative || filter.mode === "either") return false;
  const stored = normalizeKeyToken(sampleKey);
  const primary = tokensFor(filter, false);
  if (primary.has(stored)) return false;
  const withRel = tokensFor(filter, true);
  return withRel.has(stored);
}
