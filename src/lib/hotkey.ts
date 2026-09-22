/** Hold-to-hover-preview hotkey: recording it, storing it, matching it. */

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** A stable id for a key press, e.g. `alt+KeyH` or `Space`. */
export function hotkeyId(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push("meta");
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(event.code);
  return parts.join("+");
}

const CODE_LABELS: Record<string, string> = {
  Space: "Space",
  Backquote: "`",
  Tab: "Tab",
  CapsLock: "Caps",
};

/** How the design prints a binding: `⌥H`, `Space`, `\`` . */
export function hotkeyLabel(id: string | null): string | null {
  if (!id) return null;
  const parts = id.split("+");
  const code = parts.pop() ?? "";
  const symbols = parts
    .map((m) => ({ meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" })[m] ?? m)
    .join("");
  const base =
    CODE_LABELS[code] ??
    code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "").replace(/^F(\d)/, "F$1");
  return symbols + base;
}

/** True when this keyboard event is the bound hotkey. */
export function matchesHotkey(event: KeyboardEvent, id: string | null): boolean {
  return id != null && hotkeyId(event) === id;
}
