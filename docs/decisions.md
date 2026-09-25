# Sift - Decision log

Companion to [spec.md](spec.md). Answers from requirements gathering (2026-09-21). The live product rules are in spec.md; this file is history.

| # | Topic | Answer |
|---|--------|--------|
| Q1 | Folder filter | Recursive (folder + nested) |
| Q2 | Play on select default | On |
| Q3 | Hover preview | Hold-hotkey only; while held, hover plays / leave stops |
| Q4 | Hold-hotkey default | Unbound |
| Q4b | Up/Down | Same as clicking a row; respects play-on-select |
| Q5 | Row waveforms default | On |
| Q6 | Row waveform click | Play from position + hover cursor |
| Q7-Q8 | Beat snap | None/1/4/1/8/1/16; default 1/4; Shift holds free-time; markers when BPM known |
| Q8b | Multi-select | Finder/Explorer modifiers; multi-drag |
| Q9-Q11 | JIT cache | App cache; manual clear only; WAV exact source quality |
| Q12 | New files | Setting; default auto-index + optional notify; visible progress |
| Q13 | Analysis | BPM, key, loop/one-shot, suggested tags + file info |
| Q14 | Metadata store | App DB only; never touch source files in v1 |
| Q15 | Preview pitch/tempo | Native only in v1 |
| Q16 | Tags | Hierarchical, arbitrary depth; defaults; editable |
| Q17-Q18 | Key / half-double | Enharmonics always; relative and half/double toggles default Off, inline, persist |
| Q19 | Formats | WAV/AIFF/FLAC + MP3/AAC/M4A/OGG/Opus |
| Q20 | Cloud files | Hydrate on access; bulk OK; UI must not freeze |
| Q21 | Light mode | Dark only in v1 |
| Q22 | Enter / Space / latency | Enter = from start; Space = pause/resume; near-instant select→play |
| Q23-Q24 | Loop preview | Sticky toggle; Off = once always; On = loops loop; default On |
| Q25 | Ignore list | Defaults + editable in settings |
| Q26 | Output device | Picker + Default output |
| Q27 | Tabs / multi-window | Later, not v1 |
| Q28 | Default sort | Name A-Z; newest-first available |
| Q29 | Batch actions | All listed (fav, tags, type, BPM, key, reveal, re-analyze) |
| Q30 | Waveform channels | Dual L/R default; mono view in settings |
| Q31 | Zero-crossing | Hold Z; Shift+Z = free-time + zero-crossing |
| Q32-Q34 | Drag origin | List = full selected files; inside selection box = JIT clip; outside/no selection = no file drag |
| Q35 | Watching | Continuous recursive watch only; launch+manual is fallback later if needed |
| Q36 | Change depth | New, delete, rename/move, modify via mtime+size (+inode); no per-event hashing |
| Q37 | Overrides on modify | Keep overrides; refresh technical info only |
| Q38 | Drag metadata | No embedded cue/BPM/key from the app |
| Q39 | JIT names | `{originalName}_clip_{start}-{end}.wav` (+ unique if needed) |
| Q40 | Tag chips | Full path; color or inherit parent recursively |
| Q41 | Saved searches | Later |
| Q42 | Override visuals | No special styling |
| Q43 | Collections | Soon after v1 |
| Q44 | Search UI | Omni: fuzzy text + chips + highlights; no query language on roadmap |
| Q45-Q46 | Suggested tags | Auto-apply; sticky reject; Custom analysis can overwrite tags once |
| Q47 | Unknown BPM + snap | Silent free-time |
| Q48 | Next | Pause Q&A; tidy SPEC for design + engineering |
| Q49 | JIT start-end format | **A** - seconds with decimals (e.g. `1.250-3.000`) |
| Q50 | New-file handling options | **B** - Auto-index (+ optional notify) or Ask before indexing |
| Q51 | Ask-before UX | **A** - non-blocking Index/Skip; Index all/Skip all for batches |
| Q52 | Shift in list vs waveform | **A** - no real conflict; list = range-select, waveform = free-time (context/focus). Locked as Must |
| Q53 | Custom analysis dialog | **B** + force on any manual analyze; BPM analysis range (Rekordbox-style) in Settings, persisted; dialog: overwrite tags + BPM/key/loop-oneshot |
| Q54 | Default BPM analysis range | Multiple presets; default **~70-180** (wide); also include higher band e.g. ~98-195 |
| Q55 | Custom dialog BPM range | **C** - linked to Settings; changing either updates the same persisted value |
| Q56 | Context menu items | **Open** first; fav/tags/type/BPM/key; Show only files from parent folder; Reveal in Finder/Explorer (platform label); Copy path; Copy filename; re-analyze; Custom analysis. No clear-waveform-selection |
| Q57 | Folder filter menu copy | **B** - Show only files from parent folder |
| Q58 | Tag management in v1 | **A** (answered as "1") - dedicated tag management UI in v1 |
| Q59 | Tag management features | **D** - minimum only (no merge, no reset-to-defaults in v1) |
| Q60 | Delete tag with assignments | **C** - delete anytime with confirm; strip from samples; parent delete cascade-deletes children (confirm) |
| Q61 | Rex/MIDI/instruments | **A** - ignore in v1; audio only |
| Q62 | BPM preset list | **B** - multiple bands incl. ~60-150, ~68-135, ~70-180 (default), ~90-180, ~98-195 |
| Q63 | Undo | **B** - undo/redo for metadata edits; bounded history OK; not taxonomy deletes in v1 |
| Q64 | First-run | Simple empty library + add folder; no special onboarding in v1 (later) |
| Q65 | Remove library root | **B** - remove from app index only (disk untouched), with confirm |
| Q66 | Missing files | **B** - keep as missing until user removes or path returns; preserve metadata; purge missing supported |
| Q67 | Hotkey customization | **C** - only hold-to-hover rebindable in v1; full shortcut editor later |
| Q68 | Product name | **Sift** |
| Q69 | Pause + cleanup | Spec → v0.3; Q&A paused; humanize pass |
| Q70 | Locales + themes | Copy in locale files; colors/tokens in theme files. v1: `en` + one dark theme. Structure ready for more languages/themes later |
| Q71 | Column sort | Header click cycles asc (↓) → desc (↑) → clear (default Name A-Z). Persists. One column at a time |
| Q72 | Design authority | Provided Claude Design artifacts are visual source of truth for chrome; SPEC wins on behavior |
| Q73 | Default taxonomy | Ship [docs/reference/default-taxonomy.md](reference/default-taxonomy.md); tunable after dogfood |
| Q74 | Analysis + packages | Auto-tags: filename/path first. BPM/key: existing Rust crate behind trait; imperfect OK. Prefer crates/React libs over custom DSP/OS code |
| Q75 | v1 delivery | Complete Must + designs; test once the Must surfaces are done; tune after. Icon mocks OK. macOS host for build; assume stack spikes pass unless they fail |
| Q76 | Windows title bar | Custom (decorations off + caption buttons in `TitleBar`). macOS keeps Overlay + native traffic lights. Same dark chrome as Settings/Tags on both. |
