/**
 * Fixed keyboard shortcuts for the app.
 *
 * Rebindable keys (hold-to-hover) live in settings via `hotkey.ts`. Fixed
 * chords live here so handlers, menu hints, and the transport legend share
 * one table.
 */

import { hotkeyId, type ChordEvent } from './hotkey';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/** True on macOS / iOS. Used for Finder vs Explorer copy and similar. */
export function isApplePlatform(): boolean {
  return IS_MAC;
}

/** ⌘ on Apple, "Ctrl" elsewhere. */
export function primaryModSymbol(): string {
  return IS_MAC ? '⌘' : 'Ctrl';
}

/** True when the platform primary modifier is held (⌘ or Ctrl). */
export function primaryModHeld(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey;
}

/** True when Shift is held (free-time drag, range-select, free Z). */
export function shiftHeld(e: { shiftKey: boolean }): boolean {
  return e.shiftKey;
}

function primary(code: string): string[] {
  return [`meta+${code}`, `ctrl+${code}`];
}

function primaryShift(code: string): string[] {
  return [`meta+shift+${code}`, `ctrl+shift+${code}`];
}

/** Reserved for upcoming alt-chord shortcuts. */
export function primaryAlt(code: string): string[] {
  return [`meta+alt+${code}`, `ctrl+alt+${code}`];
}

export interface KeyBinding {
  /** Exact `hotkeyId` values that fire this binding. */
  readonly match: readonly string[];
  /** Short label for menus, transport, and the shortcuts list. */
  readonly hint: string;
}

const mod = primaryModSymbol();

/**
 * Every fixed chord the app listens for.
 * Add new shortcuts here; wire them with `matchesBinding` at the call site.
 */
export const keys = {
  /** Open Preferences. */
  preferences: { match: primary('Comma'), hint: `${mod},` },

  undo: { match: primary('KeyZ'), hint: `${mod}Z` },
  redo: { match: primaryShift('KeyZ'), hint: `⇧${mod}Z` },

  open: { match: primary('KeyO'), hint: `${mod}O` },
  reveal: { match: primary('KeyR'), hint: `${mod}R` },
  copyFilename: { match: primary('KeyC'), hint: `${mod}C` },
  copyPath: { match: primaryShift('KeyC'), hint: IS_MAC ? `⌥${mod}C` : `Alt+${mod}+C` },

  favorite: { match: ['KeyF'], hint: 'F' },
  tags: { match: ['KeyT'], hint: 'T' },
  /** Open the Set key panel for the focused sample. */
  setKey: { match: ['KeyK'], hint: 'K' },
  /** Open the Set BPM panel for the focused sample. */
  setBpm: { match: ['KeyB'], hint: 'B' },
  /** Cycle sample type: unset → loop → one-shot → unset. */
  cycleType: { match: ['shift+KeyT'], hint: '⇧T' },

  /**
   * Snap selection edges to zero-crossings. Shift is not part of this binding;
   * it is the free-time modifier (`shiftHeld`), so both `KeyZ` and `shift+KeyZ`
   * match here and the handler decides whether to skip snap.
   */
  zeroCrossing: { match: ['KeyZ', 'shift+KeyZ'], hint: 'Z' },

  play: { match: ['Enter'], hint: 'Enter' },
  /** Form / dialog accept. Same chord as play outside text fields. */
  confirm: { match: ['Enter'], hint: 'Enter' },
  pause: { match: ['Space'], hint: 'Space' },

  selectUp: { match: ['ArrowUp'], hint: '↑' },
  selectDown: { match: ['ArrowDown'], hint: '↓' },

  /** Close dialogs, menus, popovers. */
  dismiss: { match: ['Escape'], hint: 'Esc' },

  /** Delete the last omni chip when the query field is empty. */
  dropChip: { match: ['Backspace'], hint: '⌫' },

  /**
   * Free-time modifier (and related Shift-held gestures: waveform drag,
   * range-select, Z without snap). Not a discrete keydown; use `shiftHeld`.
   */
  freeTime: { match: [] as const, hint: '⇧' },
} as const satisfies Record<string, KeyBinding>;

export type AppBinding = keyof typeof keys;

/** True when this event is exactly the given binding. */
export function matchesBinding(event: ChordEvent, binding: KeyBinding): boolean {
  if (binding.match.length === 0) return false;
  const id = hotkeyId(event);
  return id != null && binding.match.includes(id);
}

/**
 * Rows for the Settings → Shortcuts panel. Labels stay in i18n; the key column
 * comes from `keys.*.hint` so it cannot drift from the real handlers.
 */
export const SHORTCUT_ROWS: { binding: AppBinding; descriptionKey: string }[] = [
  { binding: 'play', descriptionKey: 'keyPlayStart' },
  { binding: 'pause', descriptionKey: 'keyPause' },
  { binding: 'selectUp', descriptionKey: 'keyMove' },
  { binding: 'zeroCrossing', descriptionKey: 'keyZero' },
  { binding: 'setKey', descriptionKey: 'keySetKey' },
  { binding: 'setBpm', descriptionKey: 'keySetBpm' },
  { binding: 'cycleType', descriptionKey: 'keyCycleType' },
  { binding: 'undo', descriptionKey: 'keyUndo' },
  { binding: 'preferences', descriptionKey: 'keyPreferences' },
];
