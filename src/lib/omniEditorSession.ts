import type { ChipKind } from "./chipOrder";
import { omniHasBpm, omniHasTags, type OmniState } from "./omni";
import type { OmniTriggerKind } from "./omniQuery";

/** Open filter editor (popover under the omni field). */
export interface OmniEditorSession {
  kind: OmniTriggerKind;
  /**
   * create: empty pending chip (type: may write a default first).
   * edit: user clicked an existing chip or control.
   * retrigger: typed trigger on an existing BPM chip (first min keystroke clears max).
   */
  mode: "create" | "edit" | "retrigger";
  snapshot: OmniState;
}

export function pendingChipFromSession(session: OmniEditorSession | null): ChipKind | null {
  if (session?.mode !== "create") return null;
  if (session.kind === "type") return null;
  return session.kind;
}

/** Session mode for a typed chip trigger (`b:`, `k:`, `#`, …). */
export function triggerEditorMode(
  kind: Exclude<OmniTriggerKind, "type">,
  value: OmniState,
): "create" | "edit" | "retrigger" {
  const exists =
    (kind === "bpm" && omniHasBpm(value)) ||
    (kind === "key" && value.key != null) ||
    (kind === "tag" && omniHasTags(value));
  if (!exists) return "create";
  if (kind === "bpm") return "retrigger";
  return "edit";
}
