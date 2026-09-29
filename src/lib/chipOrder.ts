/** Omni chips in the order the user added them. Type is a toolbar control, not a chip. */

import {
  omniHasBpm,
  omniHasTags,
  type OmniState,
} from "./omni";

export type ChipKind = "folder" | "tag" | "bpm" | "key";

/** Chips that should show for this omni state, including a pending create editor. */
export function chipKindsPresent(
  value: OmniState,
  pending: ChipKind | null,
): Set<ChipKind> {
  const present = new Set<ChipKind>();
  if (value.folder != null) present.add("folder");
  if (omniHasTags(value) || pending === "tag") present.add("tag");
  if (omniHasBpm(value) || pending === "bpm") present.add("bpm");
  if (value.key != null || pending === "key") present.add("key");
  return present;
}

/**
 * Keep the current order, drop chips that disappeared, append new ones.
 * `appendOrder` sets the order when several chips appear at once (paste).
 */
export function syncChipOrder(
  prev: readonly ChipKind[],
  present: ReadonlySet<ChipKind>,
  appendOrder?: readonly ChipKind[],
): ChipKind[] {
  const next = prev.filter((kind) => present.has(kind));
  const appendFrom = appendOrder ?? [...present];
  for (const kind of appendFrom) {
    if (present.has(kind) && !next.includes(kind)) next.push(kind);
  }
  for (const kind of present) {
    if (!next.includes(kind)) next.push(kind);
  }
  return next;
}

export function cloneOmniState(value: OmniState): OmniState {
  return {
    ...value,
    tagsInclude: [...value.tagsInclude],
    tagsExclude: [...value.tagsExclude],
  };
}
