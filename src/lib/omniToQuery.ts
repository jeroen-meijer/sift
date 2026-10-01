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

/**
 * Cache key for facet `list_samples` results (histogram / root / tag counts).
 * Sort and offset do not affect counts. `libraryEpoch` invalidates on watch/analysis refresh.
 */
export function facetListCacheKey(query: SampleQuery, libraryEpoch: number): string {
  return JSON.stringify({
    e: libraryEpoch,
    folder_prefix: query.folder_prefix,
    text: query.text,
    tag_paths: query.tag_paths,
    tag_exclude_paths: query.tag_exclude_paths,
    bpm_min: query.bpm_min,
    bpm_max: query.bpm_max,
    key: query.key,
    key_either: query.key_either,
    sample_type: query.sample_type,
    half_double: query.half_double,
    relative_key: query.relative_key,
    favorites_only: query.favorites_only,
    limit: query.limit,
  });
}
