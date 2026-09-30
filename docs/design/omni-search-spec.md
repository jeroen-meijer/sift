# Sift: Omni search filters, implementation spec

Reference prototype: `Sift Omni Search v2.dc.html`. Where this doc and the prototype disagree, this doc wins.

This replaces the "No query language" line in the original search spec. There are now short typed triggers, but every trigger opens a visual editor, so nobody has to learn syntax.

---

## 1. Model

The omni field contains free text plus an ordered list of **chips**. Results must match **all** of them (AND).

| Kind | Instances | Value | Extra |
|---|---|---|---|
| `folder` | 0–1 | path (recursive) | Set from the sidebar or context menu (unchanged from v1) |
| `tag` | 0–1, **one chip holding all tags** | `include: path[]` | `exclude: path[]` |
| `bpm` | 0–1 | `lo`, `hi` (integers) | `halfDouble: bool` |
| `key` | 0–1 | `pitchClass` 0–11, `mode: maj \| min \| either` | `relative: bool` |
| `type` | **not a chip** | `all \| loop \| one-shot` | Toolbar segmented control |

Matching rules:

- **Free text:** fuzzy match on name (and other agreed fields). Highlight matches in the Name column. Tokens containing `:` or starting with `#` are never treated as free text.
- **Tag:** the sample has **every** included tag (or a descendant of it: `Drums` matches `Drums/Kick/808`), and **none** of the excluded tags or their descendants.
- **BPM:** `lo ≤ bpm ≤ hi`. If `halfDouble` is on, `bpm×2` or `bpm÷2` in range also counts. Mark those rows with a small `×2` / `÷2` badge in the BPM cell.
- **Key:** enharmonics always match (`Gb` ≡ `F#`). `either` ignores mode. If `relative` is on (only possible when a mode is set), the relative major/minor also matches. Mark those rows with a `rel` badge in the Key cell.
- **Type:** exact match on detected type.
- An editor that is open but still empty (e.g. BPM with no min yet) does **not** filter.

Persisted preferences (per user, across sessions):

- Default state of `halfDouble` and `relative` for new chips. This is the last value the user toggled.
- Recent filters: the last 4 unique committed filters.

---

## 2. Triggers

Typing a trigger at the start of a token (start of the field, or right after a space) removes the trigger text, appends an **empty pending chip** after any chips already in the row, and opens that chip's editor with keyboard focus inside it. New chips keep the order they were added.

| Trigger | Opens | When it fires |
|---|---|---|
| `#` | Tag picker | when `#` is typed |
| `b:` or `bpm:` | BPM editor | when `:` is typed |
| `k:` or `key:` | Key editor | when `:` is typed |
| `tag:` | Tag picker | when `:` is typed |
| `type:` | Type picker (sets the toolbar control) | when `:` is typed |

- **Filter of that kind already exists** (BPM, key, tag): the trigger opens the **existing** chip's editor instead of creating a new one. The first field is pre-selected, so typing overwrites it (see 3.1).
- **Trigger typed mid-word** (e.g. `dub:`): nothing happens. It stays plain text.
- **Pasting** a string like `b:89-95 k:amaj #kick -#vocals type:loop` parses all tokens into chips on paste. Unparseable tokens stay as free text.
- **Enter** in the main field with no suggestion highlighted parses any complete tokens, the same way paste does.

Pending chip: dashed accent border and value shown as `…`. It becomes a normal chip once it has a valid value. If the editor closes while the chip is still empty, the chip is removed.

---

## 3. Editors (popovers)

- **Position:** anchored under the chip, left-aligned with it and clamped to the field width, 300px wide.
- **Opening:** by trigger (focus goes into the editor), **by click on a chip**, or by Enter on a keyboard-selected chip. Hover does **not** open editors, and there is no hover affordance beyond the normal chip hover tint.
- **Live preview:** changes apply to the results immediately.
- **Confirm** (Enter / Tab / Space, see each editor), a click outside, or a click back into the main field: keep the value and close. Focus returns to the main field **without** reopening the suggestion dropdown, so the user can keep typing the next token.
- **Esc:** cancel. A new chip is removed; an existing chip reverts to its value from before the editor opened.
- **Footer in every editor:** a keyboard hint line and `Type it: <syntax>`, showing the exact typed equivalent of the current value (e.g. `b:88-92`). This is how mouse users learn the triggers.

### 3.1 BPM

- **Fields:** two number inputs, `min` and `max`. Digits only, max 3 characters.
- **Focus:** opens with `min` focused and its text selected.
- **Keys in `min`:**
  - `Tab` or `-` / `–`: jump to `max`, with its text selected.
  - `Enter` / `Space`: confirm.
  - `H`: toggle half/double.
  - `Esc`: cancel.
- **Keys in `max`:**
  - `Tab` / `Enter` / `Space`: confirm.
  - `Shift+Tab`, or `Backspace` in an empty field: back to `min`.
  - `H` and `Esc`: as in `min`.
- **Single value:** `min` with no `max` means **±2** (`90` → 88–92). The label next to the inputs says `±2`. Detected tempos are rarely exact.
- **Min > max:** the two values are swapped.
- **Valid range:** 20–300.
- **Reopening an existing BPM chip by trigger** (typed `b:` again): the first keystroke in `min` also clears `max`, so the typed flow behaves exactly like a fresh entry. Reopening by click keeps `max` (mouse users often only adjust one end).
- **Histogram:** 32 bins of 5 BPM, covering 40–200. It counts samples matching all *other* active filters. Bins inside the range are accent-coloured, the rest neutral.
- **Slider:** dual-handle range (40-200). Dragging moves the nearer thumb.
- **Half/double:** a toggle in the header, also shown inline on the chip.

### 3.2 Key

- **Text input:** focused on open, parsed on every keystroke. The parsed key shows on the right, e.g. `A min`. Accepted input:
  - Root: `a`–`g` with an optional `#` / `♯` / `b` / `♭`.
  - Mode: optional `m`, `min`, `minor`, `maj` or `major`.
  - Camelot: `1a`–`12b`, where A = minor and B = major.
  - Examples: `a`, `f#m`, `bbmin`, `8a`.
- **Root without a mode** means `either`.
- **Keys:** `Enter` / `Tab` / `Space` confirm; `Esc` cancels.
- **Piano-layout root picker:**
  - The top row has the five accidentals, each placed between the two naturals it sits between, with a gap between E and F.
  - The bottom row has the seven naturals.
  - Accidentals show both spellings: `C#/Db`, `D#/Eb`, `F#/Gb`, `G#/Ab`, `A#/Bb`.
  - Each key shows how many samples match under the other active filters (no Camelot numbers on the keys; they don't fit). Keys with zero matches are dimmed but still clickable.
  - Grid layout: 14 columns, each natural spans 2. Accidentals start at columns 2, 4, 8, 10 and 12 and span 2.
- **Mode control:** `Either / Major / Minor` below the piano.
- **Include relative:** a toggle, visible only when the mode isn't `either`, labelled with the actual relative key, e.g. "Include relative (F# min)". Also shown inline on the chip.
- Clicking a root or mode updates the text input and keeps focus in it.

### 3.3 Tags (multi-select picker)

- **Search input:** focused on open. Matches any path segment by prefix (`kick` finds `Drums/Kick` and `Drums/Kick/808`).
- **List:**
  - The full tree is indented when the query is empty; a flat list of full paths when filtering.
  - Each row has a checkbox, colour dot, name, and a count of samples that would remain if the tag were added.
  - Each row also has a small `not` button to exclude the tag.
- **Keys:**
  - `↑` / `↓`: move the highlight. It starts on the first result when the query is non-empty, and there's no highlight when the query is empty.
  - `Enter` or `,`: toggle the highlighted tag, clear the query and stay open. With no highlight, `Enter` confirms.
  - `Shift+Enter`: toggle the highlighted tag as **excluded**.
  - `Tab` / `Space`: add the highlighted tag (if the query is non-empty) and close.
  - `Backspace` with an empty query: remove the last tag from the chip.
  - `Esc`: revert all tag changes made in this session.
- **Chips:**
  - All tags live in **one TAG chip**: `TAG ● drums/kick + ● funk + NOT ● vocals ×`. Each tag has its own colour dot, and tags are joined by `+`. Included tags come first, in the order they were added, then excluded tags.
  - Excluded tags show a `NOT` prefix in the error tone (`#c9736d`).
  - **Wrapping:** the chip is capped at the field width (`max-width: 100%`), and its tag list wraps onto extra lines, so the chip (and the field) grow taller. Line gap is 3px, chip padding 2px top and bottom, minimum height 22px.
  - Clicking the chip opens the picker with every current tag checked. × removes the whole chip. To remove one tag, uncheck it in the picker or use `Backspace`.
  - The chip is removed when its last tag is removed.
- Clicking a tag in the sidebar adds or removes it as an included tag on the chip, creating the chip if needed.

### 3.4 Type

- A segmented control in the toolbar, to the right of the field: `All · Loops · One-shots`.
- `type:` opens a small picker anchored to the right end of the field:
  - `L` sets Loops, `O` sets One-shots, `←` / `→` switch.
  - `Enter` / `Tab` / `Space` confirm; `Esc` cancels.
- The words `loop` / `one-shot` in pasted text also set it.

---

## 4. Main field behaviour

### Suggestion dropdown

Shown when the field is focused by a click and no editor is open. About 260px wide. Top-left sits under the text input (after any chips) when there is room, and shifts left or shrinks so the menu stays inside the window.

- **Empty field:**
  - A list of filter types (Tag `#`, BPM range `b:`, Key `k:`). Clicking one does exactly what typing its trigger does.
  - Below it, **Recent**: the last 4 committed filters. Clicking one re-applies it; a single-instance kind replaces the existing chip.
  - Footer: "Typing # b: or k: opens the editor straight away · ⌫ selects the last chip".
- **Partial word:**
  - Trigger completions (`bp` → BPM range).
  - Up to 4 matching tags ("add as tag"), shown for words of 2 characters or more.
  - Enter with nothing highlighted still just searches names.
- **Keys:**
  - `↑` / `↓` move the highlight, `Enter` picks it.
  - `Tab` picks the highlight (or the first row) when there's text.

### Chip keyboard navigation (caret at the start of the input, or the input empty)

- `←` selects the last chip; further `←` / `→` move between chips, and `→` past the last chip returns to the input.
- `Backspace` in an empty input selects the last chip; a second `Backspace` deletes it.
- `Delete` removes the selected chip; `Enter` opens its editor.
- `Esc` clears the selection.
- Typing any character clears the selection.

### Chips

- Chip anatomy: `[tag colour dot] PREFIX value [inline toggle] ×`. Key chips show `A min` or `A maj`. Camelot (`8A`, `11B`) is still accepted when typing.
- Inline toggles: BPM `half / double`, and key `relative` (only when the key has a mode). Clicking a toggle does **not** open the editor.
- × removes the chip without opening the editor.
- A clear-all (×) at the right end of the field clears text, chips and the type control.

### Global

- `/` focuses search, unless focus is already in a text input.
- `Find similar` on the sample context menu: BPM ±3 and exact key from that sample, replacing any existing BPM/key chips. Disabled when the sample has neither BPM nor key.

---

## 5. Status bar

- Left: `N of TOTAL samples`.
- Right: `as text` followed by the canonical typed form of the current search (e.g. `b:88-92 k:am #drums/kick -#vocals type:loop kick`). This is the same string that paste accepts. Keep it: it teaches the syntax, and it's the serialisation for saved searches later.

---

## 6. Canonical serialisation

```text
bpm     b:<lo>-<hi>        b:<n> when lo = hi
key     k:<root><m|maj>    root lowercase with sharps/flats as in the NOTES table; nothing after the root for either
tag     #<path> …          one token per tag, path lowercase; excluded: -#<path>. All tag tokens merge into the single tag chip
type    type:loop | type:one-shot
folder  folder:<path>
```

Display note names: `C C# D Eb E F F# G Ab A Bb B`. The accidentals in the key picker show both spellings (see 3.2).

Camelot mapping: minor `nA` → pitch class `(8 + 7(n−1)) mod 12`; major `nB` → `(11 + 7(n−1)) mod 12`.

---

## 7. Visual tokens (Nocturne)

- **Field:** background `#101220`, 1px border `rgba(233,233,237,.13)`, 8px radius. On focus or while an editor is open, a 1px ring in `#9184d9`.
- **Chips:** 22px tall, background `#232532`, 1px border `rgba(233,233,237,.14)`, 6px radius.
  - Prefix: 10px uppercase in `#75798c`.
  - Value: JetBrains Mono 11px in `#e9e9ed`.
  - Selected or active: 1px `#9184d9` ring plus a 3px `rgba(145,132,217,.22)` halo.
- **Popovers:** background `#1c1e2c`, border `rgba(233,233,237,.14)`, 9px radius, shadow `0 18px 44px rgba(0,0,0,.55)`. Footer background `#181a28`.
- **States:**
  - Selected option: border `#9184d9`, fill `rgba(145,132,217,.2)`, text `#e7e5fe`.
  - Zero-count option: transparent fill, text `#4a4e5d`.
- **Icons:** Phosphor (tag, metronome, music-notes, repeat, lightning, crosshair-simple, clock-counter-clockwise).

---

## 8. Out of scope (unchanged)

- Saved searches and smart collections: later. The `as text` serialisation is the storage format for them.
- The Settings "BPM range preset" constrains BPM *detection* only. It is unrelated to the BPM filter.
