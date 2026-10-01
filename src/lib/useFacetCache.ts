import { useEffect, useMemo, useRef, useState } from "react";
import { ipc, type SampleQuery, type SampleRow } from "./ipc";
import type { OmniState } from "./omni";
import { facetListCacheKey, omniToSampleQuery } from "./omniToQuery";

export type FacetOmit = "bpm" | "key" | "tag";

interface Opts {
  omni: OmniState;
  /** Open filter editor; type has no facet list. */
  editorKind: FacetOmit | "type" | null;
  favoritesOnly: boolean;
  halfDouble: boolean;
  relativeKey: boolean;
  /** Bumped when the library changes; wipes the cache. */
  libraryEpoch: number;
  limit: number;
}

function facetQuery(
  omni: OmniState,
  omit: FacetOmit,
  opts: Omit<Opts, "omni" | "editorKind" | "libraryEpoch">,
): SampleQuery {
  return omniToSampleQuery(omni, {
    favoritesOnly: opts.favoritesOnly,
    halfDouble: opts.halfDouble,
    relativeKey: opts.relativeKey,
    sortColumn: "name",
    sortDirection: "asc",
    limit: opts.limit,
    omit,
  });
}

/** Omit kinds to keep warm: the open editor plus chips already in the query. */
export function facetKindsToWarm(
  omni: OmniState,
  editorKind: FacetOmit | "type" | null,
): FacetOmit[] {
  const kinds = new Set<FacetOmit>();
  if (editorKind === "bpm" || editorKind === "key" || editorKind === "tag") {
    kinds.add(editorKind);
  }
  if (omni.bpmMin != null || omni.bpmMax != null) kinds.add("bpm");
  if (omni.key != null) kinds.add("key");
  if (omni.tagsInclude.length > 0 || omni.tagsExclude.length > 0) kinds.add("tag");
  return [...kinds];
}

/**
 * Sample rows for the open filter editor's histogram / counts.
 * Keeps list_samples results by facet query key and warms sibling omit kinds for
 * active chips so switching BPM / key / tag does not wait on another fetch.
 */
export function useFacetCache({
  omni,
  editorKind,
  favoritesOnly,
  halfDouble,
  relativeKey,
  libraryEpoch,
  limit,
}: Opts): SampleRow[] {
  const [cache, setCache] = useState(() => new Map<string, SampleRow[]>());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const inFlight = useRef(new Set<string>());
  const epochRef = useRef(libraryEpoch);
  epochRef.current = libraryEpoch;

  useEffect(() => {
    inFlight.current.clear();
    setCache(new Map());
  }, [libraryEpoch]);

  const listOpts = useMemo(
    () => ({ favoritesOnly, halfDouble, relativeKey, limit }),
    [favoritesOnly, halfDouble, relativeKey, limit],
  );

  const openOmit: FacetOmit | null =
    editorKind === "bpm" || editorKind === "key" || editorKind === "tag" ? editorKind : null;

  const openKey = useMemo(() => {
    if (!openOmit) return null;
    return facetListCacheKey(facetQuery(omni, openOmit, listOpts), libraryEpoch);
  }, [omni, openOmit, listOpts, libraryEpoch]);

  const warmKinds = useMemo(
    () => facetKindsToWarm(omni, editorKind),
    [omni, editorKind],
  );

  useEffect(() => {
    const epoch = libraryEpoch;
    for (const omit of warmKinds) {
      const query = facetQuery(omni, omit, listOpts);
      const key = facetListCacheKey(query, epoch);
      if (cacheRef.current.has(key) || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      void ipc
        .listSamples(query)
        .then((rows) => {
          inFlight.current.delete(key);
          if (epochRef.current !== epoch) return;
          setCache((prev) => {
            if (prev.has(key)) return prev;
            const next = new Map(prev);
            next.set(key, rows);
            return next;
          });
        })
        .catch((err: unknown) => {
          inFlight.current.delete(key);
          console.error(err);
        });
    }
  }, [warmKinds, omni, listOpts, libraryEpoch]);

  if (!openKey) return [];
  return cache.get(openKey) ?? [];
}
