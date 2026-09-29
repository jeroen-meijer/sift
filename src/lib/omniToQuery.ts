import type { SampleQuery, SortColumn, SortDirection } from "./ipc";
import type { OmniState } from "./omni";
import { noteName, omniKeyToStored } from "./omniKey";

interface QueryOpts {
  favoritesOnly: boolean;
  halfDouble: boolean;
  relativeKey: boolean;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  limit: number;
  offset?: number;
  /** Drop one filter dimension for facet counts. */
  omit?: "bpm" | "key" | "tag" | "type" | null;
}

/** Map OmniState → list_samples SampleQuery. */
export function omniToSampleQuery(omni: OmniState, opts: QueryOpts): SampleQuery {
  const omit = opts.omit ?? null;
  const hasBpm = omit !== "bpm" && (omni.bpmMin != null || omni.bpmMax != null);
  const hasKey = omit !== "key" && omni.key != null;
  const hasTags = omit !== "tag";
  const hasType = omit !== "type" && omni.sampleType !== "all";

  let key: string | null = null;
  let keyEither = false;
  if (hasKey && omni.key) {
    if (omni.key.mode === "either") {
      key = noteName(omni.key.pitchClass);
      keyEither = true;
    } else {
      key = omniKeyToStored(omni.key);
      keyEither = false;
    }
  }

  return {
    folder_prefix: omni.folder,
    text: omni.text || null,
    tag_path: null,
    tag_paths: hasTags ? omni.tagsInclude : [],
    tag_exclude_paths: hasTags ? omni.tagsExclude : [],
    bpm_min: hasBpm ? omni.bpmMin : null,
    bpm_max: hasBpm ? omni.bpmMax : null,
    key,
    key_either: keyEither,
    sample_type: hasType ? omni.sampleType : null,
    half_double: opts.halfDouble,
    relative_key: hasKey && omni.key?.mode !== "either" ? opts.relativeKey : false,
    favorites_only: opts.favoritesOnly,
    sort_column: opts.sortColumn,
    sort_direction: opts.sortDirection,
    limit: opts.limit,
    offset: opts.offset ?? 0,
  };
}
