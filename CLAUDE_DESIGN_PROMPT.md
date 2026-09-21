# Design brief - Sift (local sample manager)

Paste this **entire file** into Claude Design as the opening prompt. Attach the screenshot set this brief describes in §2. Those images are inputs; this file is product truth when they disagree.

**For:** Claude Design
**Product:** Sift
**Platform:** Desktop · macOS + Windows · one laptop/desktop frame ≈ 1440×900 (or similar) · **dark theme only**
**Goal:** Design the v1 UI for a local sample library so a producer can find files, hear them fast, tag them, and drag a file or waveform selection into a DAW.

---

## 1. Product context

**Sift** is a dark-mode desktop app for music producers and audio engineers. It indexes local audio folders, lets you hear samples with almost no friction, analyze BPM/key/type/tags in the background, and drag full files or a selection clip into a DAW.

It is **not** a DAW, marketplace, cloud locker, account product, or full sample editor.

- Audience: people who live in a DAW all day and keep large sample libraries on disk (often multi-drive, sometimes cloud-synced folders).
- Tone: dense pro-audio tool. Readable metadata. Clear selected and playing states. No marketing chrome.
- Locales: English UI for this pass. Prefer short labels.
- Shell: single main window. No multi-tab browse in v1. Settings is a separate surface (window or pane; you decide).
- Reference feel: ADSR Sample Manager's local-library workflows (search chips, list + detail waveform, favorites, drag to DAW). Do not copy ADSR's layout, store, login, live FX dials, or MIDI mode.

Design what information and states the product needs. You own placement, hierarchy, and visual design. Prefer clear hierarchy over decoration. Do not invent out-of-scope product behavior.

---

## 2. Attached references (how to use them)

You will receive two kinds of images. Treat them differently.

### 2.1 ADSR Sample Manager screenshots (domain reference)

These show a real sample manager: folder tree, sample list, tags, omni search with chips, detail waveform, favorites, metadata columns, preview controls.

**Take:**

- The *job*: local library, instant preview, filter chips, list + waveform detail, drag-to-DAW as a primary action
- Density and information kinds (name, BPM, key, tags, type, favorites)
- That preview gain is preview-only (not a mix bus)

**Ignore / do not copy:**

- Exact layout, panel sizes, chrome, iconography, or brand
- Store / marketplace / credits / accounts / login
- Live preview FX dials, MIDI mode, or anything Sift lists as out of v1 in §6
- Light theme (Sift is dark only)

### 2.2 Other app screenshots (visual / structural inspiration)

These are apps the product owner likes. They may be **non-music** tools. They sit in a vague neighborhood of structure (dense tool UIs, good hierarchy, nice craft) or are simply pleasant to look at.

**Take:**

- Visual craft: type, spacing rhythm, contrast, selection language, panel chrome quality
- Structural ideas that fit a desktop tool (split panes, toolbars, inspectors, chip bars) when they help Sift's job

**Ignore:**

- Domains and product behavior that are not sample-library work
- Any pattern that fights dark dense metadata or drag-to-DAW
- Branding, logos, or copy from those products

When inspiration conflicts with this brief, **this brief wins**. When ADSR and inspiration conflict on layout, invent Sift's own layout.

---

## 3. Presentation format

Use **one** desktop app frame (≈ 1440×900 content area, or a clear full-window mock). Put a **labelled view switcher** beside or below the frame. Switching updates only the frame contents.

Do not spam separate artboards for every state unless a state truly needs a different window (e.g. a modal dialog may be shown inset on the main frame).

Assume mouse + keyboard. Hover and focus states are in play. Touch targets are not the priority.

---

## 4. Visual direction (freedom with guardrails)

There is **no shipped design system yet**. Invent a cohesive dark UI that fits a native-class desktop audio tool.

Guardrails:

- **Dark only.** No light mode exploration in this pass.
- Dense and readable. Metadata must scan at a glance.
- Selected row and currently playing sample must be unmistakable.
- Avoid purple-on-black cliché, heavy glow stacks, glassmorphism as the main look, and generic "AI dashboard" chrome.
- Prefer real typefaces suited to a tool UI. Do not default to Inter / Roboto / Arial as the hero brand face.
- Waveforms should look credible (stereo L/R detail, simpler row waveforms), not decorative abstract art.
- Tag chips are colored; hierarchy shows as **full path** text on the chip (e.g. `Drums/Kick/808`), not leaf-only.

You may define a small token set (surfaces, text, accent, danger, chip colors) inside the mock. Keep it consistent across views.

---

## 5. Information to support (what, not how)

### 5.1 Main chrome (always available in the library experience)

Show that the app is a **local file library**, not a store.

Must support:

- Multiple library roots and a hierarchical folder browser over them
- Favorite folders and favorite samples
- Omni search: one field that holds free-text *and* removable structured chips (folder, tags, BPM range, key, …)
- Sample results list with columns at least: name, type (loop / one-shot when known), BPM, key, tags, favorite (column set may be flexible)
- Inline **row waveforms** (default on; toggleable)
- Detail / preview surface for the focused sample: dual L/R waveform for stereo (mono lane for mono files), playhead, selection region with adjustable edges, snap markers when BPM is known and snap ≠ None
- Preview controls: preview gain, loop-preview sticky toggle, transport affordances implied by keyboard (Enter / Space) without requiring a huge transport deck
- Output device is a settings concern; surface a way to reach settings
- Non-blocking analysis / indexing progress (global and/or per row). Never a modal that blocks browse/play
- Clear **missing file** state when a path disappeared but the index entry remains

### 5.2 Primary content and behaviors the UI must make obvious

| Capability       | What the user must understand from the UI                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play on select   | Selecting a row can start preview immediately (preference exists; default on)                                                                                                   |
| Row waveform     | Click plays from that point; hover shows a light vertical cursor                                                                                                                |
| Detail waveform  | Click sets playhead; drag selects a region; Shift = temporary free-time vs beat snap; Z = zero-crossing on edges                                                                |
| Snap             | Setting: None / 1/4 / 1/8 / 1/16 (default 1/4). Labels are yours                                                                                                                |
| Drag to DAW      | List drag = full files for the multi-selection. Drag from **inside** the detail selection box = JIT clip of that region. Outside selection / no selection = no file drag        |
| Omni chips       | Folder click (or "Show only files from parent folder") adds a recursive folder chip. Chips are removable                                                                        |
| BPM / key search | BPM range chip; half/double include toggle (default off, inline, sticky). Key chip; enharmonics always match; relative major/minor include toggle (default off, inline, sticky) |
| Tags             | Hierarchical; colored; full-path chips; autocomplete; management surface to rename/add/move/color/delete                                                                        |
| Overrides        | Effective BPM/key/type/tags shown plainly (no special "detected vs override" styling required)                                                                                  |
| Multi-select     | Finder/Explorer rules: Shift range, ⌘/Ctrl toggle                                                                                                                               |

### 5.3 Context menu (sample rows)

Required items (grouping/chrome is yours; Open is first):

1. Open (OS default app)
2. Favorite / unfavorite
3. Add/remove tags
4. Set type (loop / one-shot)
5. Set BPM
6. Set key
7. Show only files from parent folder
8. Reveal in Finder / File Explorer (platform-appropriate label)
9. Copy path
10. Copy filename
11. Re-analyze
12. Custom analysis…

### 5.4 Settings (minimum surfaces to design)

- Play on select
- Preview-related defaults as needed
- Waveform mono/summed view toggle
- Output device + Default
- BPM analysis range presets (linked with Custom analysis dialog): include ~60-150, ~68-135, ~70-180 (default), ~90-180, ~98-195
- Ignore list (editable)
- JIT clip cache path + clear cache
- Hold-to-hover-preview hotkey (default unbound; only rebindable shortcut in v1)

### 5.5 Dialogs / confirms to cover

- Remove library root (index only; disk untouched)
- Delete tag (samples using it lose the tag)
- Delete parent tag (cascade children; dialog must make cascade obvious)
- Custom analysis (force-run on selection): checkboxes for overwrite tags / re-run BPM / re-run key / re-run loop vs one-shot; BPM range control linked to settings
- Ask-before-index prompt when that mode is on: Index / Skip, plus Index all / Skip all when many files arrive
- Remove missing sample(s) from library

### 5.6 Empty, loading, error, edge

- First launch: empty library + add folder (no guided onboarding)
- Empty search results
- Analysis running (library still usable)
- Missing sample selected (preview/drag unavailable; metadata still visible)
- BPM unknown: beat snap behaves as free-time; markers not required
- Large result sets: list must feel capable of huge libraries (virtualized list language is fine; do not imply loading every waveform at full res)

---

## 6. Hard constraints (out of v1 / banned)

Do **not** design:

- Store, marketplace, credits, watermarked cloud previews, login, accounts, cloud library sync
- Light mode
- MIDI mode, preview pitch/tempo stretch, DAW sync, reverse, live preview FX dials (HPF/LPF/fade)
- Plugin/VST hosting
- Query language (`tag:kick bpm:120`)
- Multi-tab / multi-window browse
- Guided onboarding
- Full shortcut editor (only hold-hover is rebindable)
- Tag merge; reset taxonomy to defaults
- Writing metadata into source audio files
- Destructive batch organize/rename of files on disk as a primary feature
- Mobile / web / Linux frames
- Lorem ipsum; inventing controls "because sample managers usually have them"
- Stock lifestyle photography as hierarchy

Soon after v1 (may note as future, do not build into v1 chrome): user collections. Later: saved searches.

---

## 7. Views the design must cover

Label switcher controls exactly (you may add more; do not drop these):

1. **First launch** - empty library, add folder
2. **Library populated** - folder browser + list + detail; some favorites; analysis idle
3. **Omni search with chips** - text + folder/tag/BPM/key chips; match highlighting in names
4. **Row waveforms on** - hover cursor + clear playing/selected states
5. **Detail selection → clip drag** - visible selection region; affordance that this selection is what leaves the app on drag
6. **Multi-select** - several rows selected
7. **Missing file** - one result in missing state; detail explains unavailable preview/drag
8. **Ask before index** - non-blocking prompt for new files (Index / Skip / all variants)
9. **Custom analysis dialog** - checkboxes + BPM range
10. **Tag management** - taxonomy browse/edit/color/delete confirm (cascade)
11. **Settings** - at least the items in §5.4
12. **Context menu** - Open first; full item set visible

Optional extras if useful: loop-preview on vs off; snap None vs 1/4 with markers; Windows vs macOS Reveal label (one frame with a note is enough).

---

## 8. Design freedom

You decide layout, density, panel structure, typography, and visual priority within this brief.

You must **not**:

- Clone ADSR pixel-for-pixel
- Add store/account/MIDI/FX surfaces
- Invent a second product (mixer, piano roll, cloud drive UI)
- Rely on the inspiration apps' domains

If something feels missing for a coherent tool, leave a short designer note on the frame. Do not invent a product behavior to fill the gap.

---

## 9. Appendix - sample data (use verbatim)

### Library roots

- `/Users/alex/Samples/Packs`
- `/Volumes/SFX/Field`
- `~/Music/Recorded Takes`

### Folders (examples)

- `Packs/Drums/Kicks`
- `Packs/Drums/Snares`
- `Packs/Synths/Bass`
- `Field/City/Night`
- `Recorded Takes/2026-03 Vocals`

### Samples (rows)

| Name                      | Type     | BPM | Key      | Tags                         | Favorite | Notes        |
| ------------------------- | -------- | --- | -------- | ---------------------------- | -------- | ------------ |
| `808_sub_hit_A.wav`       | one-shot |     | A        | `Drums/Kick/808`             | ★        |              |
| `kick_tight_90.wav`       | one-shot | 90  |          | `Drums/Kick`                 |          |              |
| `snare_room_verb.wav`     | one-shot |     |          | `Drums/Snare`, `FX/Reverb`   | ★        |              |
| `loop_funk_110_Gm.wav`    | loop     | 110 | G minor  | `Drums/Breaks`, `Genre/Funk` |          |              |
| `bass_wobble_140_F#.wav`  | loop     | 140 | F# minor | `Synths/Bass`                |          |              |
| `night_tram_amb.flac`     | one-shot |     |          | `Field/City`, `Ambience`     |          | missing file |
| `vocal_take_03_comp.aiff` | one-shot |     | D minor  | `Vocals`                     |          |              |
| `hat_closed_micro.wav`    | one-shot |     |          | `Drums/Hats`                 |          | analyzing…   |

### Omni examples

- Text: `kick` with highlight on `kick_tight_90.wav`
- Chips: `folder: Packs/Drums/Kicks` · `tag: Drums/Kick` · `BPM: 85-95` · half/double off · `key: A` · relative off

### Analysis progress

- Global: `Analyzing 128 of 4,402`
- Row badge or secondary line: `Analyzing…` on `hat_closed_micro.wav`

### Custom analysis dialog copy (starting point)

- Overwrite tags
- Re-run BPM
- Re-run key
- Re-run loop vs one-shot
- BPM range: `70-180` (default preset)

### Tag taxonomy snippets

- `Drums/Kick`, `Drums/Kick/808`, `Drums/Snare`, `Drums/Hats`, `Drums/Breaks`
- `Synths/Bass`
- `FX/Reverb`
- `Field/City`
- `Ambience`
- `Vocals`
- `Genre/Funk`

### Keyboard (document in a note or settings; do not build a full editor)

- Enter: play from start
- Space: pause/resume (restart if finished)
- Up/Down: move selection (respects play-on-select)
- Shift: list = range select; waveform = temporary free-time
- Z: zero-crossing on selection edges
- Hold-hover hotkey: unbound by default
