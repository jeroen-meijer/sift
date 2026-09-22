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
export type OptionalColumn = "type" | "bpm" | "key" | "tags";

export const OPTIONAL_COLUMNS: OptionalColumn[] = ["type", "bpm", "key", "tags"];

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
