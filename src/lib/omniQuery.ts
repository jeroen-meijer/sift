/** Parse and serialize the omni typed form. Detect triggers. See omni-search-spec §2 and §6. */

import { type ChipKind } from "./chipOrder";
import {
  EMPTY_OMNI,
  type OmniState,
  type SampleTypeFilter,
} from "./omni";
import { parseOmniKey, serializeOmniKeyBody } from "./omniKey";

export type OmniTriggerKind = "tag" | "bpm" | "key" | "type";

const BPM_MIN = 20;
const BPM_MAX = 300;
const SINGLE_BPM_SLACK = 2;

export function clampBpm(n: number): number {
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n)));
}

/** ±2 around a single BPM for filtering. */
export function singleBpmRange(n: number): { min: number; max: number } {
  const v = clampBpm(n);
  return { min: clampBpm(v - SINGLE_BPM_SLACK), max: clampBpm(v + SINGLE_BPM_SLACK) };
}

function parseBpmToken(body: string): { min: number; max: number } | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const range = /^(\d{1,3})\s*[-–]\s*(\d{1,3})$/.exec(trimmed);
  if (range) {
    let lo = clampBpm(Number(range[1]));
    let hi = clampBpm(Number(range[2]));
    if (lo > hi) [lo, hi] = [hi, lo];
    return { min: lo, max: hi };
  }
  if (/^\d{1,3}$/.test(trimmed)) {
    return singleBpmRange(Number(trimmed));
  }
  return null;
}

export function parseTypeToken(body: string): SampleTypeFilter | null {
  const t = body.trim().toLowerCase();
  if (t === "loop" || t === "loops") return "loop";
  if (t === "one-shot" || t === "oneshot" || t === "one_shot" || t === "shot") {
    return "one-shot";
  }
  if (t === "all") return "all";
  return null;
}

/** Last whitespace-separated token and the text before it. */
export function splitTrailingWord(text: string): { stem: string; word: string } {
  if (!text.includes(" ")) return { stem: "", word: text };
  const word = text.split(/\s+/).pop() ?? "";
  const stem = text.slice(0, text.length - word.length).replace(/\s+$/, "");
  return { stem, word };
}

/**
 * Detect a trigger at the end of the current input text (token start).
 * Returns the kind and the text with the trigger stripped, or null.
 */
export function detectTrigger(
  text: string,
): { kind: OmniTriggerKind; textWithoutTrigger: string } | null {
  const m = /(^|\s)(bpm:|b:|key:|k:|tag:|type:|#)$/i.exec(text);
  if (!m) return null;
  const token = m[2]?.toLowerCase() ?? "";
  const prefix = text.slice(0, m.index) + (m[1] ?? "");
  const stripped = prefix.replace(/\s+$/, "");

  if (token === "#") return { kind: "tag", textWithoutTrigger: stripped };
  if (token === "b:" || token === "bpm:") return { kind: "bpm", textWithoutTrigger: stripped };
  if (token === "k:" || token === "key:") return { kind: "key", textWithoutTrigger: stripped };
  if (token === "tag:") return { kind: "tag", textWithoutTrigger: stripped };
  if (token === "type:") return { kind: "type", textWithoutTrigger: stripped };
  return null;
}

/** Trigger suggestions for a partial word in the dropdown. Labels come from locales. */
export function triggerCompletions(
  word: string,
): { kind: OmniTriggerKind; insert: string }[] {
  const w = word.toLowerCase();
  if (!w) return [];
  const all: { kind: OmniTriggerKind; insert: string; keys: string[] }[] = [
    { kind: "tag", insert: "#", keys: ["#", "tag"] },
    { kind: "bpm", insert: "b:", keys: ["b", "bpm"] },
    { kind: "key", insert: "k:", keys: ["k", "key"] },
    { kind: "type", insert: "type:", keys: ["type", "t"] },
  ];
  return all
    .filter((c) => c.keys.some((k) => k.startsWith(w) || w.startsWith(k)))
    .map(({ kind, insert }) => ({ kind, insert }));
}

export interface ParsedOmniQuery {
  state: OmniState;
  /** Chip kinds first seen while parsing, in token order. */
  chipKinds: ChipKind[];
}

/**
 * Parse pasted or Enter-committed text into omni state and chip encounter order.
 * Unparseable tokens stay as free text (space-joined).
 * Merges into `base` (tags accumulate, other kinds replace).
 */
export function parseOmniQuery(raw: string, base: OmniState = EMPTY_OMNI): ParsedOmniQuery {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { state: { ...base, text: "" }, chipKinds: [] };
  }

  let next: OmniState = {
    ...base,
    text: "",
    tagsInclude: [...base.tagsInclude],
    tagsExclude: [...base.tagsExclude],
  };
  const free: string[] = [];
  const chipKinds: ChipKind[] = [];
  const seen = new Set<ChipKind>();
  const noteChip = (kind: ChipKind) => {
    if (seen.has(kind)) return;
    seen.add(kind);
    chipKinds.push(kind);
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === "loop" || lower === "loops") {
      next = { ...next, sampleType: "loop" };
      continue;
    }
    if (lower === "one-shot" || lower === "oneshot") {
      next = { ...next, sampleType: "one-shot" };
      continue;
    }

    if (lower.startsWith("-#") && lower.length > 2) {
      const path = token.slice(2);
      noteChip("tag");
      next = {
        ...next,
        tagsExclude: next.tagsExclude.includes(path)
          ? next.tagsExclude
          : [...next.tagsExclude, path],
        tagsInclude: next.tagsInclude.filter((p) => p !== path),
      };
      continue;
    }
    if (lower.startsWith("#") && lower.length > 1) {
      const path = token.slice(1);
      noteChip("tag");
      next = {
        ...next,
        tagsInclude: next.tagsInclude.includes(path)
          ? next.tagsInclude
          : [...next.tagsInclude, path],
        tagsExclude: next.tagsExclude.filter((p) => p !== path),
      };
      continue;
    }

    const tagged = /^(tag:)(.+)$/i.exec(token);
    if (tagged?.[2]) {
      const path = tagged[2];
      noteChip("tag");
      next = {
        ...next,
        tagsInclude: next.tagsInclude.includes(path)
          ? next.tagsInclude
          : [...next.tagsInclude, path],
        tagsExclude: next.tagsExclude.filter((p) => p !== path),
      };
      continue;
    }

    const bpm = /^(?:b|bpm):(.+)$/i.exec(token);
    if (bpm?.[1]) {
      const range = parseBpmToken(bpm[1]);
      if (range) {
        noteChip("bpm");
        next = { ...next, bpmMin: range.min, bpmMax: range.max };
        continue;
      }
    }

    const keyTok = /^(?:k|key):(.+)$/i.exec(token);
    if (keyTok?.[1]) {
      const key = parseOmniKey(keyTok[1]);
      if (key) {
        noteChip("key");
        next = { ...next, key };
        continue;
      }
    }

    const typeTok = /^type:(.+)$/i.exec(token);
    if (typeTok?.[1]) {
      const sampleType = parseTypeToken(typeTok[1]);
      if (sampleType) {
        next = { ...next, sampleType };
        continue;
      }
    }

    const folderTok = /^folder:(.+)$/i.exec(token);
    if (folderTok?.[1]) {
      noteChip("folder");
      next = { ...next, folder: folderTok[1] };
      continue;
    }

    /* Tokens with `:` or starting with `#` that did not parse stay out of free text. */
    if (token.includes(":") || token.startsWith("#") || token.startsWith("-#")) {
      continue;
    }
    free.push(token);
  }

  return { state: { ...next, text: free.join(" ") }, chipKinds };
}

/** Paste-compatible typed form (spec §6). */
export function serializeOmniQuery(state: OmniState): string {
  const parts: string[] = [];

  if (state.folder) parts.push(`folder:${state.folder}`);

  if (state.bpmMin != null || state.bpmMax != null) {
    const lo = state.bpmMin ?? state.bpmMax ?? 0;
    const hi = state.bpmMax ?? state.bpmMin ?? 0;
    parts.push(lo === hi ? `b:${String(lo)}` : `b:${String(lo)}-${String(hi)}`);
  }

  if (state.key) {
    parts.push(`k:${serializeOmniKeyBody(state.key)}`);
  }

  for (const path of state.tagsInclude) {
    parts.push(`#${path.toLowerCase()}`);
  }
  for (const path of state.tagsExclude) {
    parts.push(`-#${path.toLowerCase()}`);
  }

  if (state.sampleType === "loop") parts.push("type:loop");
  if (state.sampleType === "one-shot") parts.push("type:one-shot");

  if (state.text.trim()) parts.push(state.text.trim());

  return parts.join(" ");
}

const RECENT_KEY = "sift.omni.recent";
const RECENT_MAX = 4;

export function loadRecentFilters(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecentFilter(serialized: string): string[] {
  const s = serialized.trim();
  if (!s) return loadRecentFilters();
  const prev = loadRecentFilters().filter((x) => x !== s);
  const next = [s, ...prev].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
