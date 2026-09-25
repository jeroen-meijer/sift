# Localization

Playbook for user-facing copy in Sift. Product rules: [spec.md](../spec.md) §4.14.
Stack notes: [tech-stack.md](tech-stack.md).

## Stack

- **i18next** + **react-i18next**
- Init: [`src/i18n/index.ts`](../src/i18n/index.ts)
- Sources: [`src/locales/<lang>/<namespace>.json`](../src/locales/en/)
- v1 ships **English only** (`en`). Adding a language is new JSON files under
  `src/locales/<lang>/` plus wiring in `src/i18n/index.ts`. No in-app language
  picker yet.

Components call `t("…")` / `<Trans />`. Never put user-facing literals in UI
code. Themes own colors; locales own words.

## Namespaces

One JSON file per concern (i18next namespace):

| File | Owns |
| --- | --- |
| `common.json` | Shared actions, chrome labels, omni bar, status bar, context menus |
| `library.json` | Library shell, table, detail, transport, waveform, library dialogs |
| `settings.json` | Settings window (nav, appearance, playback, analysis, shortcuts, about) |
| `tags.json` | Tag manager + delete confirm |

Put a string in the namespace of the screen or surface that shows it. Shared
buttons (`Cancel`, `Close`) stay in `common.action`. Context-menu verbs stay in
`common.menu` even when a library dialog repeats a similar phrase.

## Nesting

Keys are nested by **UI surface**, then by **concept**. A reader should tell
from the path where the string appears and what it is for.

```json
"playback": {
  "playOnSelect": {
    "label": "Play on select",
    "hint": "Moving the selection with ↑ ↓ starts preview immediately."
  }
}
```

Call site: `t("playback.playOnSelect.label")`.

### Nest siblings under one concept

When several strings describe the **same** thing (a setting row, a dialog, a
theme card), nest them. Do **not** flatten with suffixes.

```json
"prefer": {
  "reanalyze": {
    "label": "Re-analyze entire library",
    "hint": "…",
    "dialog": {
      "title": "Erase analysis data?",
      "body": "…",
      "confirm": "Erase analysis data"
    }
  }
}

"avoid": {
  "reanalyzeLibrary": "…",
  "reanalyzeLibraryHint": "…",
  "reanalyzeLibraryTitle": "…",
  "reanalyzeLibraryBody": "…",
  "reanalyzeLibraryConfirm": "…"
}
```

Same idea for dialogs (`title` / `body` / `confirm`), theme cards
(`appearance.themes.nocturne.name` / `.blurb`), and label+hint pairs.

Use a flat key only when the string stands alone (e.g. a lone button with no
sibling copy for that concept).

### Plurals

i18next plurals stay as siblings with `_one` / `_other` (and more forms later):

```json
"missingSamples": {
  "label": "Missing samples",
  "hint_one": "{{count}} indexed file is not on disk right now.",
  "hint_other": "{{count}} indexed files are not on disk right now."
}
```

Call: `t("library.missingSamples.hint", { count })`.

### Placeholders and markup

- Interpolation: `{{name}}`, `{{count}}`, `{{formatted}}` (i18next).
- Inline markup: `<0>…</0>` with `<Trans i18nKey="…" />` (react-i18next).
- Do not invent markdown (`**bold**`) or HTML tags beyond what `<Trans>` expects.

## Usage in React

```tsx
const { t } = useTranslation("settings");
const { t: tc } = useTranslation("common");

t("playback.playOnSelect.label");
tc("action.cancel");
```

- Pass the **namespace** to `useTranslation`, not a dotted key path.
- Prefer one `t` per namespace in a component. For a dense subsection, a short
  prefix in the key is enough (`analysis.custom.*`); no need for a second helper
  unless it clarifies a large block.
- Dynamic segments (theme id, BPM preset): `` t(`appearance.themes.${id}.name`) ``
  only when the segment is a known enum, not free user input.

Maps that only exist to translate enums (theme name keys, shortcut description
keys, BPM preset label keys) should point at nested paths, not parallel flat
keys.

## Errors

Rust (and other) failures that reach the UI should carry a **stable code** or
structured kind. Map code → locale string at the UI boundary. Do not show raw
`Display` / `toString()` text from the backend as the only user-facing message
when you can avoid it.

## Voice

UI copy is short and concrete. One string, one job.

| Do | Don't |
| --- | --- |
| Plain verbs: is, has, use, try again | Copula padding (`serves as`), vague verbs (`enables`, `allows you to`) |
| Same word for the same concept | Synonym cycling (color / colour, remove / delete for the same action) |
| Straight ASCII quotes and punctuation | Em dashes, en dashes, curly quotes, emoji |
| Labels that stay labels | Inflating a 3-word label into a marketing sentence |
| Current product behavior | "We've improved…", "Now you can finally…" |

Hard bans in locale values: em dash characters, en dash characters, and spaced
`--` used as a dash. Prefer a period, comma, or colon.

Skip hype in helpers. Prefer the fact or the next step. Do not use these in
locale strings:

```text
seamless, robust, leverage, streamline, comprehensive, delight, effortless,
crucial (as praise)
```

When rewriting copy, match neighbors in the same file. Do not invent product
rules to sound specific.

## Adding a string

1. Choose the namespace for the surface that shows it.
2. Nest under the existing feature object when one fits; otherwise add a clear
   feature key.
3. Add only `en` for now. When a second locale exists, every key must exist in
   every language file for that namespace.
4. Wire `t("…")` / `<Trans />` at the call site. No hardcoded English in JSX.
5. Keep `src/i18n/index.ts` `ns` / `resources` in sync if you add a namespace file.

## Adding a language

1. Copy `src/locales/en/*.json` to `src/locales/<lang>/`.
2. Translate values; keep keys and placeholder names identical.
3. Register the language in `src/i18n/index.ts` (`resources`, `lng` / fallback
   policy as needed).

## Out of scope here

- Theme tokens and CSS variables → `src/theme/`, theme CSS
- Changelog / PR / commit prose → `/humanize` and repo commit rules
- Default tag taxonomy data → may ship as data; dialog chrome still goes through
  locales
