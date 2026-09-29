/** Omni-bar query state and the columns the picker can hide. */

export type SampleTypeFilter = "all" | "loop" | "one-shot";
export type KeyMode = "maj" | "min" | "either";

export interface OmniKey {
  /** Pitch class 0–11 (C = 0). */
  pitchClass: number;
  mode: KeyMode;
}

export interface OmniState {
  text: string;
  folder: string | null;
  tagsInclude: string[];
  tagsExclude: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  key: OmniKey | null;
  sampleType: SampleTypeFilter;
}

export const EMPTY_OMNI: OmniState = {
  text: "",
  folder: null,
  tagsInclude: [],
  tagsExclude: [],
  bpmMin: null,
  bpmMax: null,
  key: null,
  sampleType: "all",
};

/** Columns the picker can hide. Name always stays visible. */
export type OptionalColumn =
  | "source"
  | "type"
  | "bpm"
  | "key"
  | "wave"
  | "tags"
  | "date_added"
  | "date_created";

export const OPTIONAL_COLUMNS: OptionalColumn[] = [
  "source",
  "type",
  "bpm",
  "key",
  "wave",
  "tags",
  "date_added",
  "date_created",
];

export function omniHasQuery(value: OmniState): boolean {
  return (
    value.text.length > 0 ||
    value.folder != null ||
    value.tagsInclude.length > 0 ||
    value.tagsExclude.length > 0 ||
    value.bpmMin != null ||
    value.bpmMax != null ||
    value.key != null ||
    value.sampleType !== "all"
  );
}

export function omniHasTags(value: OmniState): boolean {
  return value.tagsInclude.length > 0 || value.tagsExclude.length > 0;
}

export function omniHasBpm(value: OmniState): boolean {
  return value.bpmMin != null || value.bpmMax != null;
}

/**
 * Chip label for a folder filter: root folder name + path under it, matching
 * the sidebar (e.g. `Library/Drums/808s`).
 */
export function folderChipLabel(
  folderPath: string,
  roots: readonly { path: string; name: string }[],
): string {
  const normalized = folderPath.replace(/\\/g, "/");
  const root = roots
    .map((r) => ({ ...r, path: r.path.replace(/\\/g, "/") }))
    .filter((r) => normalized === r.path || normalized.startsWith(`${r.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!root) return folderPath;
  if (normalized === root.path) return root.name;
  return `${root.name}/${normalized.slice(root.path.length + 1)}`;
}

/** Toggle a path in the include list (sidebar click). Creates/clears the chip. */
export function toggleTagInclude(state: OmniState, path: string): OmniState {
  const included = state.tagsInclude.includes(path);
  const tagsInclude = included
    ? state.tagsInclude.filter((p) => p !== path)
    : [...state.tagsInclude.filter((p) => p !== path), path];
  const tagsExclude = state.tagsExclude.filter((p) => p !== path);
  return { ...state, tagsInclude, tagsExclude };
}
