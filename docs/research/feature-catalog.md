# Feature catalog

Living list of sample-manager feature ideas for Sift. Mark status as we ship. Add new ideas under the right section. Not a commit roadmap. Product rules stay in [spec.md](../spec.md); this catalog does not override them.

| Status | Meaning |
|--------|---------|
| Done | Shipped in a form that covers the idea for Sift's scope |
| Partial | Real capability exists; major pieces still missing |
| Open | No product surface yet (may be out of spec / stretch) |

How to add: one idea per bullet, status first, short name, then a plain sentence of intent. Nest Done / Missing under Partial when useful.

Last reviewed: 2026-09-28 (includes Sep 26 producer feedback).

## Search and library hygiene

- Open: sound-alike search. Drop in arbitrary audio; find the most similar samples in the library.
- Open: text search by sound. Type something like "dusty lofi rim with short tail" and match on audio embeddings, not filenames.
- Open: duplicate detection. Same sample across packs under different names. Saves disk space.
- Open: "used in project" tracking. See which samples appear in which projects, plus a "never used" filter.

Sift today: omni search is filename / tags / BPM / key / folder chips (multi-word any-order text). No embeddings, no content-hash dupes, no DAW project graph.

## Analysis and filters

- Partial: BPM and groove detection. Tempo, plus swing amount, so you can filter for loops with MPC swing.
  - Done: BPM from audio (`stratum-dsp` + envelope fallback) and from filenames (`140BPM`, `_174_`, ...); omni BPM chip + half/double; filterable column.
  - Missing: swing / groove amount; filter for MPC swing.
- Open: loudness / energy metrics and filters. Measure how loud or punchy a sample is so you can find soft ambience vs hard hits, sort a pile like a setlist by energy, and avoid rebuilding kits by ear alone.
  - Industry terms: **peak** (max sample, dBFS, clipping), **RMS** (root-mean-square energy over a window; rough loudness), **crest factor** (peak minus RMS; punch / dynamic range), **LUFS** (ITU-R BS.1770: K-weighted + gated integrated loudness for perceived level over time).
  - Producer preference (2026-09): for one-shots and short elements, prefer **peak-oriented / short-window RMS energy** (how hard the loudest part hits) over integrated LUFS. LUFS averages and gates silence, so it is a poor answer to "is this hit soft or slamming?". Called-out uses: pull low-energy / low-transient ambience from a large pack; order tracks by energy the way you order a setlist.
  - For Sift: store at least one energy number (for example max short-window RMS and/or peak, optionally crest). Optional LUFS later for long loops / full tracks. Expose as column, omni chip / range filter, and sort.
  - Sift today: basic file tech info for playback only; no loudness / energy columns or filters.
- Open: stereo width and mono compatibility. Useful for kicks and bass that should stay mono.
- Partial: spectral filters (brightness, low end, "has sub below 50 Hz").
  - Done: spectral bass/mid/treble coloring on waveforms (visual only).
  - Missing: stored metrics and omni/list filters on brightness / sub / etc.
- Open: mood / character sliders (dark to bright, calm to aggressive). Timbre / feel, separate from loudness energy above (how hard the transient hits).

Related analysis already in Sift (not separate catalog rows): key (audio + filename), loop / one-shot, auto tags from path tokens, background analyze that does not block browse.

## Audition and editing in the browser

- Partial: waveform slicing. Chop loops into one-shots and export without opening a DAW.
  - Done: detail waveform selection + JIT clip drag to the DAW (trimmed region as a new WAV).
  - Missing: multi-slice chop UI, batch export of slices as separate one-shots into the library.
- Partial: quick edits on preview (pitch, reverse, fade, trim, normalize), then drag the edited version out.
  - Done: trim via selection to JIT drag; zero-crossing / beat snap; preview gain (preview only).
  - Missing: pitch, reverse, fade, normalize as preview edits (out of spec v1).
- Open: skip leading / trailing silence on audition. When you play a file, jump past dead air at the start (and optionally ignore a silent tail) so the hit is immediate. Threshold-based; keep a little padding so the attack is not clipped.
  - Producer ask (2026-09): "skip empty spaces in waveform when listening"; framed as trim empty at begin and end (already vaguely planned).
  - Prior art: BaseHead **Skip Silence** (Standard / Ultra) marks START / END and skips head/tail dead air on play; separate **Trim Head/Tail** and **Strip Gaps** for destructive edits. Audition skip is play-cursor behavior. Destructive silence strip belongs under quick edits if we add it later.
  - Distinct from: manual selection + JIT clip drag (already Done).
- Open: audition in context. Preview samples in sync with DAW playback so you hear the loop against your own track.
  - Explicitly out of spec v1 (no DAW sync).

## Organization and UX

- Partial: collections and smart folders. Saved queries such as "all kicks in F, shorter than 300 ms, punchy" that update when packs are added.
  - Done: omni chips (folder / tag / BPM / key), favorite samples and folders, favorites-only toggle; folder browser + "show parent folder".
  - Missing: named collections (spec: soon after v1); saved searches / smart folders that persist (spec: later).
- Partial: ratings and color tags, synced across devices.
  - Done: hierarchical colored tags, favorites (binary rating).
  - Missing: 1-5 star (or similar) ratings; any cloud sync of tags across devices (local DB only).
- Done: keyboard-first navigation. Arrow keys to audition, one key for favorite, one to send or drag to the DAW.
  - Arrows move selection and play (play-on-select); Space / Enter; favorite shortcut; reveal / copy / tags / BPM / key shortcuts; hold-hover preview (rebindable). Drag remains pointer-based. Full shortcut editor is later per the spec.

## Creative tools (stretch)

- Open: layering tool. Stack 2-3 hits with automatic phase and timing alignment, then bounce the result.
- Open: variation generator. Make about ten small variations of a hit (micro-pitch, envelope, saturation) so patterns sound less robotic.
- Open: loop to MIDI. Pull melody or drum pattern out of a loop as MIDI.
- Open: stem separation. Split a loop into drums, bass, and melody.
- Open: pattern suggestions. Pick a kit; get a groove suggestion that fits the genre.

All remain research / stretch. Not in spec v1.

## Library management

- Partial: quick ignore presets for common non-sample / non-useful audio. Checkbox / dropdown "quick settings" to toggle ignore for frequent junk without editing glob strings by hand. Sampler previews ignored by default.
  - Producer ask (2026-09): ignore "Kontakt files" by default; UI of select/unselect for often-seen types. Reporter first said `.ink`, then `.nki`. Screenshot of the list (Orchestral Tools Metropolis Ark I on `F:\`) shows the real clutter is **NKS / Kontakt browser preview audio**, not instrument patches:
    - Path: `…\TM Patches\…\07. Rotdorn Horns a3\.previews\09. Horns a3 Swell Short TM.nki.ogg`
    - Name column shows `….nki.ogg` (double extension); Sift correctly treats them as `.ogg` and indexes them.
    - Industry convention (NI / Komplete Kontrol / Kontakt): a (often hidden) **`.previews`** folder next to patches holds OGG previews named `PatchName.nki.ogg` or `PatchName.nksn.ogg`. Orchestral Tools and other vendors ship these so Kontakt / KK can audition a patch without loading the instrument. They are short reference clips, not production samples.
  - Settled UI: one checkbox, label along the lines of **Ignore NKS/Kontakt preview files**. When on (default), apply these globs:
    - `**/.previews/**` (primary; canonical NI hidden folder; safe to ignore)
    - `**/*.nki.ogg` and `**/*.nksn.ogg` (extra coverage for the naming convention; NI previews are OGG)
  - Conservative: leave undotted `**/previews/**` out of the default. Someone might keep real demos or bounced previews there. Optional later toggle if vendor trees without the leading dot show up often.
  - Skip bare `*.nki.*` / `*.nksn.*`: broader than needed, and bare `.nki` / `.nksn` never become rows (audio allowlist). Name patterns alone also miss oddly named files still sitting under `.previews`.
  - Optional later preset for non-audio sampler sidecars (the spec already wants these ignored): **`.nki`** (Kontakt Instrument; there is no `.ink`), plus `.nkm` / `.nkb` / `.nkp` / `.nkr` / `.nkc` / `.nkx` / `.nksn` / `.nkl` / `.nka` / `.nicnt`, and `.exs` / `.sfz` / Rex/RX2 / MIDI / images / PDFs / ZIPs / DAW projects. Leave `.ncw` alone here: it is Kontakt lossless compressed audio, outside today's decode list, not the same problem as preview OGGs.
  - Separate issue: indexing a whole Kontakt library tree can still flood the library with thousands of per-key / per-articulation WAVs under Samples folders. The screenshot is specifically `.previews` OGGs.
  - Done: editable `ignore_list` in Settings; default globs for OS/junk (`.git`, `node_modules`, `.DS_Store`, …). Audio allowlist (`wav` / `aiff` / `flac` / `ogg` / …).
  - Missing: the NKS/Kontakt preview checkbox wired to the globs above (on by default); more quick-preset checkboxes for other junk types if we add them later.
- Open: cancel indexing / analysis mid-run. Stop an accidental scan of a huge SSD or root without quitting the app.
  - Producer ask (2026-09): "stop scanning" when thousands of files keep going after a mistaken root add; today the escape hatch is close Sift.
  - Should cover both filesystem walk / index and the background analyze queue (clear progress, leave already-written rows intact).
  - Related queue gaps (not separate product features; fix with cancel / queue work):
    - Files that fail to decode (`open_audio` / `decode_all` returns `Ok(())` without setting `analyzed_at`) stay forever in `list_analysis_queue_ids` and retry every launch.
    - Queuing a second job for the same sample id does not replace the mode: a later `Custom` is dropped if a `Normal` job is already waiting (and the reverse). Only priority moves an existing job to the front.
    - No user-facing cancel or “skip this file” for analyze.
- Open: auto rename and organize. Consistent names such as `Kick_F_120ms_Punchy.wav`.
  - Destructive batch rename is out of spec v1 as a primary feature. Filename parsing for BPM/key exists; writing new names on disk does not.
- Partial: cloud and offline libraries. Splice (and similar) samples you already downloaded, shown with local samples in one place.
  - Done: roots on cloud File Provider paths (e.g. Dropbox); Online only / local availability; metadata-first browse; analyze when files hydrate.
  - Missing: Splice (or other store) catalog integration; unified "purchased but not downloaded" UI beyond OS provider stubs.

## Priority hints

Closer to what Sift already aims at (further work pays off): smart folders / saved searches, loudness / RMS energy + spectral metrics and filters, skip-silence audition, cancel scan, quick ignore presets, duplicate detection, deeper keyboard polish, multi-slice and quick edit.

Research / experiment unless scope expands: sound-alike and text-by-sound search, DAW-synced audition, stem separation, pattern suggestions.
