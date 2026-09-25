/** Omni-bar query state and the columns the picker can hide. */

export interface OmniState {
  text: string;
  folder: string | null;
  tags: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  key: string | null;
}

export const EMPTY_OMNI: OmniState = {
  text: "",
  folder: null,
  tags: [],
  bpmMin: null,
  bpmMax: null,
  key: null,
};

/** Columns the picker can hide. Name and Waveform are controlled elsewhere. */
export type OptionalColumn =
  | "source"
  | "type"
  | "bpm"
  | "key"
  | "tags"
  | "date_added"
  | "date_created";

export const OPTIONAL_COLUMNS: OptionalColumn[] = [
  "source",
  "type",
  "bpm",
  "key",
  "tags",
  "date_added",
  "date_created",
];

export function omniHasQuery(value: OmniState): boolean {
  return (
    value.text.length > 0 ||
    value.folder != null ||
    value.tags.length > 0 ||
    value.bpmMin != null ||
    value.bpmMax != null ||
    value.key != null
  );
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
