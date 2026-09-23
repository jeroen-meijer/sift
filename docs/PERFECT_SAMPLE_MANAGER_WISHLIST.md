# Perfect sample manager wishlist

A producer friend listed what they would want in an ideal sample browser or manager (2026-09). Originally feedback, not a roadmap. This file is now a **living status** against Sift: what is done, partial, or still open.

Status key:

| Mark | Meaning |
|------|---------|
| **Done** | Shipped in a form that covers the wishlist intent for Sift’s scope |
| **Partial** | Real capability exists; major wishlist pieces still missing |
| **Not started** | No product surface yet (may be out of SPEC / stretch) |

Last reviewed: 2026-09-23 (post filename BPM/key, detail context menu, sidebar folder UX).

---

## Search and library hygiene

- **Not started — Sound-alike search.** Drop in arbitrary audio; find the most similar samples in the library.
- **Not started — Text search by sound.** Type something like "dusty lofi rim with short tail" and match on audio embeddings, not filenames.
- **Not started — Duplicate detection.** Same sample across packs under different names. Saves a lot of disk space.
- **Not started — "Used in project" tracking.** See which samples appear in which projects, plus a "never used" filter for material that never left the library.

Sift today: omni search is **filename / tags / BPM / key / folder chips** (multi-word any-order text). No embeddings, no content-hash dupes, no DAW project graph.

---

## Analysis and filters

- **Partial — BPM and groove detection.** Tempo, plus swing amount, so you can filter for "loops with MPC swing".c
  - **Done in Sift:** BPM from audio (`stratum-dsp` + envelope fallback) and from filenames (`140BPM`, `_174_`, …); omni BPM chip + half/double; filterable column.
  - **Missing:** swing / groove amount; filter “MPC swing”.
- **Not started — Loudness and dynamics.** LUFS, peak, and crest factor, so a kit does not need rebalancing later.
  - Sift stores basic file tech info for playback; no LUFS / crest columns or filters.
- **Not started — Stereo width and mono compatibility.** Useful for kicks and bass that should stay mono.
- **Partial — Spectral filters.** Brightness, amount of low end, "has sub below 50 Hz".
  - **Done in Sift:** spectral bass/mid/treble coloring on waveforms (visual only).
  - **Missing:** stored metrics and omni/list filters on brightness / sub / etc.
- **Not started — Mood / energy sliders.** Dark to bright, calm to aggressive.

Also related (not on the friend’s list, but analysis Sift already has): **key** (audio + filename), **loop / one-shot**, **auto tags** from path tokens, background analyze that does not block browse.

---

## Audition and editing in the browser

- **Partial — Waveform slicing.** Chop loops into one-shots and export without opening a DAW.
  - **Done in Sift:** detail waveform **selection** + **JIT clip drag** to the DAW (trimmed region as a new WAV).
  - **Missing:** multi-slice chop UI, batch export of slices as separate one-shots into the library.
- **Partial — Quick edits on preview.** Pitch, reverse, fade, trim, normalize, then drag the edited version out.
  - **Done in Sift:** trim via selection → JIT drag; zero-crossing / beat snap; preview gain (preview only).
  - **Missing:** pitch, reverse, fade, normalize as preview edits (out of SPEC v1).
- **Not started — Audition in context.** Preview samples in sync with DAW playback so you hear the loop against your own track.
  - Explicitly out of SPEC v1 (no DAW sync).

---

## Organization and UX

- **Partial — Collections and smart folders.** Saved queries such as "all kicks in F, shorter than 300 ms, punchy" that update when packs are added.
  - **Done in Sift:** omni chips (folder / tag / BPM / key), favorite samples and folders, favorites-only toggle; folder browser + “show parent folder”.
  - **Missing:** named collections (SPEC: soon after v1); **saved searches** / smart folders that persist (SPEC: later).
- **Partial — Ratings and color tags**, synced across devices.
  - **Done in Sift:** hierarchical **colored tags**, favorites (binary rating).
  - **Missing:** 1–5 star (or similar) ratings; any cloud sync of tags across devices (local DB only).
- **Done — Keyboard-first navigation.** Arrow keys to audition, one key for favorite, one to send or drag to the DAW.
  - Arrows move selection and play (play-on-select); Space / Enter; favorite shortcut; reveal / copy / tags / BPM / key shortcuts; hold-hover preview (rebindable). Drag remains pointer-based (normal for desktop sample managers). Full shortcut editor is later per SPEC.

---

## Creative tools (stretch)

- **Not started — Layering tool.** Stack 2-3 hits with automatic phase and timing alignment, then bounce the result.
- **Not started — Variation generator.** Make about ten small variations of a hit (micro-pitch, envelope, saturation) so patterns sound less robotic.
- **Not started — Loop to MIDI.** Pull melody or drum pattern out of a loop as MIDI.
- **Not started — Stem separation.** Split a loop into drums, bass, and melody.
- **Not started — Pattern suggestions.** Pick a kit; get a groove suggestion that fits the genre.

All remain research / stretch. Not in SPEC v1.

---

## Library management

- **Not started — Auto rename and organize.** Consistent names such as `Kick_F_120ms_Punchy.wav`.
  - Destructive batch rename is out of SPEC v1 as a primary feature. Filename **parsing** for BPM/key exists; writing new names on disk does not.
- **Partial — Cloud and offline libraries.** Splice (and similar) samples you already downloaded, shown with local samples in one place.
  - **Done in Sift:** roots on cloud File Provider paths (e.g. Dropbox); **Online only** / local availability; metadata-first browse; analyze when files hydrate.
  - **Missing:** Splice (or other store) catalog integration; unified “purchased but not downloaded” UI beyond OS provider stubs.

---

## Summary scoreboard

| Area | Done | Partial | Not started |
|------|------|---------|-------------|
| Search / hygiene | 0 | 0 | 4 |
| Analysis / filters | 0 | 2 | 3 |
| Audition / editing | 0 | 2 | 1 |
| Organization / UX | 1 | 2 | 0 |
| Creative stretch | 0 | 0 | 5 |
| Library management | 0 | 1 | 1 |

Closest to “accidentally fully done”: **keyboard-first navigation**. Strongest partials: **BPM** (no groove), **waveform trim → DAW** (no multi-slice / FX edits), **tags + favorites** (no ratings / sync / smart folders), **cloud File Provider roots** (no Splice).

---

## Notes

- Research / experiment territory unless scope expands: sound-alike and text-by-sound search, DAW-synced audition, stem separation, pattern suggestions.
- Closer to what Sift already aims at (and where further work pays off): smart folders / saved searches, loudness and spectral **metrics + filters**, duplicate detection, deeper keyboard polish, multi-slice and quick edit.
- Product rules stay in [SPEC.md](../SPEC.md); this wishlist does not override SPEC.
