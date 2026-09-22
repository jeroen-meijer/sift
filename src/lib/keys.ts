/**
 * Musical key picker helpers. Analyzer stores keys like `Am` / `F#`; the
 * picker shows `A min` / `F# maj` and accepts typed forms such as `amaj`,
 * `amin`, `cma`, `c major`, `bbmin`.
 */

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Flat spellings that map onto the sharp-side roots we list. */
const ENHARMONIC_TO_SHARP: Record<string, string> = {
  db: "c#",
  eb: "d#",
  fb: "e",
  gb: "f#",
  ab: "g#",
  bb: "a#",
  cb: "b",
  "e#": "f",
  "b#": "c",
};

/** Longest-first so `major` wins over `ma`. */
const MAJ_SUFFIXES = ["major", "maj", "ma"] as const;
const MIN_SUFFIXES = ["minor", "min", "mi"] as const;

export interface MusicalKey {
  /** Value written to the DB (analyzer-compatible: `A`, `Am`). */
  value: string;
  /** Label shown in the picker (`A maj`, `A min`). */
  label: string;
}

/** Every major and minor root the picker offers, C→B. */
export const MUSICAL_KEYS: MusicalKey[] = ROOTS.flatMap((root) => [
  { value: root, label: `${root} maj` },
  { value: `${root}m`, label: `${root} min` },
]);

function compactText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replaceAll("♯", "#")
    .replaceAll("♭", "b")
    .replaceAll(/\s+/g, "");
}

function resolveRoot(root: string): string {
  return ENHARMONIC_TO_SHARP[root] ?? root;
}

/** Collapse free-form key text into a match token (`amaj` → `a`, `bb min` → `a#m`). */
export function normalizeKeyToken(raw: string): string {
  const token = compactText(raw)
    .replaceAll("major", "")
    .replaceAll("maj", "")
    .replaceAll("minor", "m")
    .replaceAll("min", "m");

  const minor = token.endsWith("m");
  const root = minor ? token.slice(0, -1) : token;
  const sharp = resolveRoot(root);
  return minor ? `${sharp}m` : sharp;
}

function matchTokens(key: MusicalKey): string[] {
  return [normalizeKeyToken(key.value), normalizeKeyToken(key.label)];
}

/** Compact spellings users type while searching (`cmaj`, `cma`, `amin`, …). */
function searchForms(key: MusicalKey): string[] {
  const isMinor = key.value.endsWith("m");
  const root = compactText(isMinor ? key.value.slice(0, -1) : key.value);
  const forms = [compactText(key.label), compactText(key.value), root];
  if (isMinor) {
    forms.push(`${root}m`, `${root}mi`, `${root}min`, `${root}minor`);
  } else {
    forms.push(`${root}ma`, `${root}maj`, `${root}major`);
  }
  return forms;
}

interface ParsedQuery {
  compact: string;
  /** Normalized root token (`c`, `a#`). */
  root: string;
  mode: "maj" | "min" | null;
}

function parseKeyQuery(raw: string): ParsedQuery {
  const compact = compactText(raw);
  for (const suffix of MAJ_SUFFIXES) {
    if (compact.length > suffix.length && compact.endsWith(suffix)) {
      const root = resolveRoot(compact.slice(0, -suffix.length));
      return { compact, root, mode: "maj" };
    }
  }
  for (const suffix of MIN_SUFFIXES) {
    if (compact.length > suffix.length && compact.endsWith(suffix)) {
      const root = resolveRoot(compact.slice(0, -suffix.length));
      return { compact, root, mode: "min" };
    }
  }
  if (/^[a-g][#b]?m$/i.test(compact)) {
    const root = resolveRoot(compact.slice(0, -1));
    return { compact, root, mode: "min" };
  }
  const needle = normalizeKeyToken(raw);
  const minor = needle.endsWith("m");
  return {
    compact,
    root: minor ? needle.slice(0, -1) : needle,
    mode: null,
  };
}

/** Keys whose label or value contains the typed query (empty query → all). */
export function filterMusicalKeys(query: string): MusicalKey[] {
  const trimmed = query.trim();
  if (!trimmed) return MUSICAL_KEYS;

  const parsed = parseKeyQuery(trimmed);
  const needle = parsed.mode === "min" ? `${parsed.root}m` : parsed.root;

  let hits = MUSICAL_KEYS.filter((key) => {
    if (parsed.mode === "maj") return normalizeKeyToken(key.value) === parsed.root;
    if (parsed.mode === "min") return normalizeKeyToken(key.value) === `${parsed.root}m`;
    return searchForms(key).some(
      (form) => form === parsed.compact || form.startsWith(parsed.compact),
    );
  });

  hits = [...hits].sort((a, b) => {
    const aExact = matchTokens(a).includes(needle) ? 0 : 1;
    const bExact = matchTokens(b).includes(needle) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.label.localeCompare(b.label);
  });

  return hits;
}

/**
 * Resolve typed text to a stored key value. Prefers an exact picker match,
 * then the top filter hit, otherwise the trimmed raw string (free-form).
 */
export function resolveKeyInput(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed === "") return null;
  const needle = normalizeKeyToken(trimmed);
  const exact = MUSICAL_KEYS.find((key) => matchTokens(key).includes(needle));
  if (exact) return exact.value;
  const hits = filterMusicalKeys(trimmed);
  if (hits[0]) return hits[0].value;
  return trimmed;
}

/** True when `stored` is the same pitch/mode as `key` (enharmonic-aware). */
export function keyMatchesStored(stored: string | null | undefined, key: MusicalKey): boolean {
  if (stored == null || stored.trim() === "") return false;
  return normalizeKeyToken(stored) === normalizeKeyToken(key.value);
}
