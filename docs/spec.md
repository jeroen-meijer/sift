# Sift - Product Specification

**Version:** 0.3.1  
**Status:** Q&A paused. Ready for UI design and implementation planning.  
**Platforms:** macOS, Windows  
**Users:** Music producers and audio engineers  
**Reference feel:** ADSR Sample Manager local-library workflows (not the store)  
**Stack:** Undecided. Assume audio, analysis, and I/O stay fast enough for large local libraries.

Shared reference for design and engineering. States behavior and constraints. Does not prescribe layout, chrome, or visual brand beyond §2.

Decision history: [decisions.md](decisions.md).

---

## 1. What Sift is

Sift is a dark-mode desktop app for browsing, auditioning, tagging, and dragging local audio samples into a DAW.

Priorities:

- Hear a sample with almost no friction
- Handle large libraries across multiple roots
- Analyze in the background without blocking the UI
- Drag a full file or a waveform selection into a DAW
- Search the way producers think (name, tags, BPM, key, type, folder)

Not a DAW, marketplace, cloud locker, or full sample editor.

---

## 2. How to use this doc

### Design

You own placement, hierarchy, and visual design. Do not copy ADSR's layout. Match the job: local library, instant preview, omni search with chips, list + detail waveform, drag to DAW.

Must read clearly:

- This is a local file library
- Preview is immediate; volume is preview-only
- Analysis can run without blocking browse/play
- Drag-to-DAW is a primary action

Appearance defaults: dark only in v1; dense pro-audio UI; clear selected / playing states.

Do not invent light mode, store UI, accounts, or MIDI mode for v1.

### Engineering

Treat Must lines as acceptance criteria. Should means ship if cheap; do not block v1. Open / later means do not invent a product decision in code without updating this doc.

You may choose libraries and storage internals. Product rules below (DB-only metadata, watch behavior, JIT cache, latency) stay fixed unless this doc changes.

---

## 3. Scope

### In v1

| Area | Behavior |
|------|----------|
| Library | Multiple roots; add/remove root (confirm; disk untouched); folder browser; favorite folders/samples; editable ignore list |
| Browse | Folder click or "Show only files from parent folder" → recursive folder chip; sample list |
| Audition | Play on select (default on); hold-hover hotkey (default unbound, only rebindable shortcut); Enter / Space / Up-Down; near-instant select→play; sticky loop-preview toggle; preview gain; output device + Default |
| Waveforms | Detail dual L/R (mono view in settings); row waveforms default on (click-to-play-from + hover cursor); selection edges; beat snap + Shift/Z |
| Analysis | File info, BPM (range presets), key, loop/one-shot, auto tags; sticky rejects; forced manual/custom re-analyze; never blocks UI |
| Metadata | App DB only; undo/redo for sample metadata edits |
| Tags | Hierarchy; full-path colored chips; tag management UI (rename/add/move/color/delete with confirm + cascade) |
| Search | Omni field: fuzzy text + chips; match highlighting; half/double and relative-key toggles |
| Filesystem | Continuous recursive watch; missing files stay until purged; Auto-index or Ask before indexing |
| DAW | List drag = full files; selection-box drag = JIT clip |
| Formats | WAV, AIFF/AIF, FLAC, MP3, AAC/M4A, OGG, Opus only |
| First launch | Empty library + add folder; no guided onboarding |

### Out of v1

- Store / marketplace / credits / watermarked cloud previews
- Account, cloud sync of the library, multi-user
- MIDI mode, preview pitch/tempo stretch, DAW sync, reverse, live preview FX dials
- Plugin/VST hosting
- Query language (`tag:kick bpm:120`)
- Light mode
- Mobile / web / Linux
- Destructive batch organize/rename of files on disk as a primary feature
- AI generative sound design
- Rex/RX2, MIDI, sampler instruments as library items
- Tag merge; reset taxonomy to defaults
- Full shortcut editor (only hold-hover is rebindable)

### Soon after v1 (high priority)

- User collections (hand-picked sample lists across folders)

### Later (not soon)

- Saved searches (omni text + chips)
- Multi-tab / multi-window browse contexts
- Guided onboarding
- Full keyboard shortcut editor

### Not on the roadmap

- Dedicated query language

---

## 4. Requirements

Priority: Must · Should · Open · Later

### 4.1 Library and folders

- Must: Multiple user-configured root folders.
- Must: Hierarchical folder browser over those roots.
- Must: User can remove a root from the library (index only; never delete files on disk) after a confirm dialog.
- Must: Clicking a folder adds a single folder filter chip to the omni search (not a separate browse mode).
- Must: Folder filter is recursive (folder + all nested subfolders).
- Must: Favorite folders.
- Should: When multiple roots exist, show which root a folder belongs to.
- Must: Default ignore list for scanning (e.g. `.git`, `node_modules`, common OS junk).
- Must: Ignore list editable in settings.

### 4.2 Sample list

- Must: List/table of samples matching current filters.
- Must: Columns at least: name, type (loop/one-shot if known), BPM, key, tags, favorite (column visibility may vary).
- Must: Inline row waveforms, toggleable; default on.
- Must: Selecting a row updates the detail/preview surface.
- Must: Row waveforms are interactive: click plays from that position; hover shows a light/white vertical cursor at the play-from point.
- Should: Lazy/downsample waveforms so large result sets stay usable. Peakfile format and renderer are an engineering choice.
- Must: Multi-select like Finder/Explorer: Shift = range; ⌘ (macOS) / Ctrl (Windows) = additive toggle.
- Must: Drag multi-selection as multiple full files when the drop target accepts them.
- Must: Context menu starts with Open, and includes all of:
 - Open (first): open with the OS default app for that file type
 - Favorite / unfavorite
 - Add/remove tags
 - Set type (loop/one-shot)
 - Set BPM
 - Set key
 - Show only files from parent folder: set the omni folder chip to this sample's parent directory (recursive, same as folder-browser click)
 - Reveal in Finder (macOS) / Reveal in File Explorer (Windows)
 - Copy path
 - Copy filename
 - Re-analyze (normal, forced)
 - Custom analysis…
- Should: Menu chrome/grouping is design's; the items above are required for v1.
- Out of v1 for this menu: clear/reset waveform selection.
- Must: Sort is user-changeable and persists (active column + direction, or default).
- Must: Default sort: Name A-Z (no column-sort indicator beyond that default).
- Must: Clicking a sortable column header cycles: ascending (arrow down) → descending (arrow up) → clear (back to default Name A-Z). One active sort column at a time.
- Must: Sortable columns include at least: name, type, BPM, key, and date added/discovered. Waveform column is not sortable. Favorite may be sortable (favorites first / non-favorites first) if cheap.
- Should: Tags column sort is optional in v1 (multi-tag rows make ordering ambiguous).
- Must: Shift is context-based: in the sample list, range-select; in the detail waveform, temporary free-time (disable beat snap). No conflict.

### 4.3 Playback and keyboard

- Must: Preference: play on select Yes/No. Default: Yes.
- Must: When Yes, selecting a sample starts preview immediately.
- Must: When No, select prepares preview; play is explicit (Enter or equivalent).
- Must: Hold-to-hover-preview: user-bound hotkey; while held, hover plays and leave stops; release ends hover-preview (and stops hover-started playback). Default binding: unbound. This is the only user-rebindable shortcut in v1.
- Must: Up/Down moves selection to prev/next row and behaves like clicking that row (respects play-on-select).
- Must: Enter plays from the start immediately.
- Must: Space pauses/resumes from the playhead. If playback finished, Space starts from the beginning.
- Must: Select→play feels near-instant when racing Up/Down with play-on-select on. A ~0.5s hitch per step is a bug. Prefetch/cache is an implementation detail; the feel is the requirement.
- Later: Full shortcut editor for playback/nav and other actions.

### 4.4 Waveforms

#### Detail (focused sample)

- Must: Show a waveform for the selected sample.
- Must: Click sets playhead and can play from that point.
- Must: Drag a selection region; edges adjustable.
- Must: Selection is the source for JIT clip → DAW (see §4.6).
- Must: Snap quantization setting: None, 1/4, 1/8, 1/16. Default: 1/4. Label copy is up to design.
- Must: When snap is not None and BPM is known, show snap markers on the waveform.
- Must: When BPM is unknown, beat snap silently acts as free-time (no markers). No required "unavailable" state. Design may explore a disabled treatment later if silent free-time confuses users.
- Must: Hold Shift to temporarily disable beat snap (DAW-style).
- Must: Hold Z for zero-crossing snap on selection edges.
- Must: Shift+Z = free-time + zero-crossing together.
- Should: Visible playhead while playing.
- Must: Stereo files: dual L/R display by default (ADSR-style). Mono files: one lane. Settings toggle for summed/mono view.

#### Row waveforms

- Must: Toggle; default on.
- Must: Click-to-play-from + hover cursor as in §4.2.

### 4.5 Preview audio

- Must: Preview volume/gain affects app output only, never the file on disk or JIT drag renders.
- Must: Output device picker, including Default output (OS default). Persists.
- Must: Switching samples stops/interrupts cleanly.
- Must: Preview at native speed and pitch in v1 (no key lock, transpose, or tempo stretch).
- Must: Sticky, quick "loop preview" toggle (not buried in settings). Persists across samples and sessions.
- Must: Loop preview Off → every sample plays once.
- Must: Loop preview On → loop-typed samples loop; one-shots still play once.
- Must: Default: loop preview On.
- Out of v1: Reverse playback; live FX dials (HPF/LPF/fade).

### 4.6 Drag to DAW

Drag origin decides the payload:

| Origin | Payload |
|--------|---------|
| Sample list (any selected row) | Full, unaltered files for the current multi-selection |
| Inside the detail waveform selection box | JIT WAV clip of that region for the focused sample only |
| Detail waveform outside the selection, or no selection | No file drag (scrub / edit selection only) |

- Must: JIT files live in an app cache directory; path shown in settings.
- Must: Cache kept until the user clears it in settings (no auto delete on quit / age in v1).
- Must: JIT = WAV matching source sample rate, bit depth, and channel count exactly. No quality loss.
- Must: Do not embed extra cue/BPM/key metadata into dragged files (full path drops or JIT).
- Must: JIT names like `{originalName}_clip_{start}-{end}.wav`, with a disambiguator if needed so concurrent drags never collide. `{start}` and `{end}` are seconds with decimals (e.g. `kick_clip_1.250-3.000.wav`).

### 4.7 Analysis

- Must: Runs in the background; never blocks browse, search, or playback.
- Must: Extract file info when available: sample rate, bit depth, channels, duration, format.
- Must: Detect BPM, key (unknown/low-confidence state when unsure), loop vs one-shot, and suggested tags.
- Must: Auto-tag v1 priority: **filename and path token matching** into the default taxonomy (see [docs/reference/default-taxonomy.md](reference/default-taxonomy.md)). Audio-based tagging is optional later if a crate earns it.
- Must: BPM / key / loop-vs-one-shot: prefer an existing Rust analysis crate (or bindings) behind `trait Analyzer`. Imperfect results with unknown/low-confidence are acceptable for v1; user overrides win.
- Must: Auto-apply suggested tags into the tag taxonomy where possible. User can edit afterward like any tags.
- Must: Removing an auto-applied tag is a sticky rejection. Normal re-analyze must not put it back.
- Must: Two modes:
 - Normal re-analyze (context menu / batch): always force-runs on the selected samples, even if mtime/size are unchanged. Refreshes technical info and non-overridden auto fields; does not re-apply rejected tags; does not overwrite user tag choices.
 - Custom analysis: context menu; runs on all selected samples; always force-runs. Dialog checkboxes for this run:
 - Overwrite tags (re-suggest and replace tags, including previously rejected)
 - Re-run BPM
 - Re-run key
 - Re-run loop vs one-shot
- Must: BPM analysis range (Rekordbox-style): persisted setting that constrains detected BPM to a chosen min-max band so half-tempo misreads are less likely. Adjustable in Settings and in the Custom analysis dialog; those controls are linked (changing either updates the same persisted value). Used by auto analysis and by manual/custom analysis when BPM is (re)run. Ship presets including at least: ~60-150, ~68-135, ~70-180, ~90-180, ~98-195 (exact integers tunable in implementation). Default for new installs: ~70-180.
- Must: Show analysis progress (per sample and/or globally) without a blocking modal.
- Should: Re-analyze a sample or folder (normal mode, forced).
- Must: User overrides win for display/search until cleared.
- Open: Exact analysis crate(s); spike `stratum-dsp` (or similar) and fall back to unknown when confidence is low.

### 4.8 Metadata storage and overrides

- Must: User can override BPM, tags, key, type, and other agreed fields.
- Must: Overrides persist across sessions.
- Must: All app metadata lives in an app database. Never modify source audio files for metadata in v1.
- Must: UI shows the effective value only. No special styling for "detected vs overridden." Overrides stay editable and clearable.
- Must: Undo/redo for metadata edits (tags on samples, BPM, key, type, favorites). Bound the history if needed for performance (e.g. last N actions / current session). Exact bound is engineering. Not required for tag-taxonomy deletes/restructures in v1 (those use confirm dialogs).
- Out of v1: Write-back to file tags; sidecars beside samples.

### 4.9 Tags

- Must: Hierarchical tags, arbitrary depth (e.g. `Drums/Kick/808`).
- Must: Ship a default taxonomy ([docs/reference/default-taxonomy.md](reference/default-taxonomy.md)). Users can rename, add, and reorganize.
- Must: Add/remove tags on samples; hierarchy-aware autocomplete.
- Should: Tag browser / facets with counts.
- Must: Chips show the full path, not leaf-only.
- Must: Tags have color. A tag may set its own color or inherit from its parent (recursively).
- Must: Dedicated tag management UI in v1 (screen/panel; placement is design's): browse the taxonomy, rename, add tags/categories, reparent/move, set own color or inherit, delete tags.
- Must: Deleting a tag is allowed even if samples still use it. After confirm, remove that tag from all samples.
- Must: Deleting a parent tag cascade-deletes its children, also after confirm (dialog must make the cascade clear).
- Out of v1 for tag management: merge tags; reset taxonomy to shipped defaults.

### 4.10 Favorites

- Must: Favorite samples and folders.
- Should: Fast nav/filter to favorites.
- Soon after v1: Collections / playlists of hand-picked samples across folders.

### 4.11 Search

- Must: Omni search field (ADSR-style): free text and structured chips in one control (folder, BPM range, tags, key, …).
- Must: Free text is fuzzy (name and other agreed text fields).
- Must: Highlight matching text in results (e.g. name column).
- Must: Tag chips with hierarchy-aware autocomplete.
- Must: BPM range chip; half/double-time include toggle default Off, inline (not settings-only), persists.
- Must: Key chip; enharmonics always match (`Gb` ≡ `F#`); relative major/minor include toggle default Off, inline, persists.
- Must: Folder click → removable folder chip.
- Should: One-shot / loop type filter.
- Not on roadmap: Query language.
- Later: Saved searches (persist omni text + chips). Smart/auto-updating collections can wait for that pass or after.

### 4.12 Filesystem watching and indexing

- Must: Continuous recursive watch per root while the app is open (watch the root, not every file individually).
- Must: Detect new, deleted, renamed/moved (prefer in-place index update over delete+new when the OS allows), and content modifications.
- Must: When a file path disappears (deleted outside the app, volume offline, etc.), keep the sample in the index as missing until the user removes it from the library or the file returns at that path. Preserve app metadata (tags, overrides, favorites). Show a clear missing state in the UI; preview/drag unavailable while missing.
- Must: User can remove missing samples from the library (index only).
- Should: Batch "remove missing" / purge action.
- Must: Modification check is cheap: on event, compare indexed mtime + size (+ inode when available). Re-analyze only if those differ. No per-event content hashing. No full-library content scans for this.
- Must: Debounce noisy events (e.g. Dropbox sync/hydration). Never freeze the UI.
- Must: Setting for new-file handling with two modes:
 - Auto-index (default), with an optional notification toggle
 - Ask before indexing: non-blocking prompt with Index / Skip, plus Index all / Skip all when multiple new files arrive together
- Must: Indexing/analysis progress is visible and non-blocking (exact chrome is design's).
- Must: After modify re-analyze: keep all user overrides (BPM, key, tags, type, etc.); refresh technical file info only (sample rate, bit depth, channels, duration, format, mtime/size, and similar). Do not overwrite creative metadata with new auto-detection.
- Fallback (only if watch fails performance later): scan on launch + manual refresh. Do not ship both modes in v1.

### 4.13 Appearance

- Must: Dark only in v1 (one shipped theme).
- Must: Dense, readable metadata; clear selected and playing states.
- Must: Colors and other theme tokens live outside components (dedicated theme files / token tables). Adding or changing a theme later must not require hunting through UI code for hex values.
- Later: Additional themes (including light) can ship by adding theme definitions; no v1 theme picker required.

### 4.14 Localization

- Must: User-visible copy lives in locale resource files (not hardcoded strings in components), keyed for lookup.
- Must: v1 ships English (`en`) only.
- Must: Adding a language later is mainly new locale files plus wiring the language list; UI code should not need string-by-string edits.
- Should: Prefer short keys grouped by screen/feature (same shape as loudline's `locales/<lang>/…` layout).
- Out of v1: In-app language picker UI (fine to add when a second locale exists).

### 4.15 Formats and cloud paths

- Must: These formats work for indexing, preview, and drag-out: WAV, AIFF/AIF, FLAC, MP3, AAC/M4A, OGG, Opus.
- Must: Ignore non-audio junk by default (images, PDFs, ZIPs, DAW projects, Rex/RX2, MIDI, sampler instruments such as `.nki`/`.exs`/`.sfz`, …).
- Should: Add more decodeable audio formats later without redesigning the product.
- Out of v1: Rex/RX2, MIDI, sampler instruments as first-class library items.
- Must: Treat cloud online-only files as normal paths. Reading for analysis/preview/drag hydrates via the filesystem. Bulk hydration of a root during indexing is acceptable. No separate download UX.
- Must: Hydration and analysis stay async; the UI must not freeze.

### 4.16 First launch

- Must: First launch is simple: empty library and a way to add a root folder. No guided onboarding flow in v1.
- Later: Optional onboarding.

---

## 5. Non-functional

- Latency: Select→play near-instant under rapid keyboard browsing.
- Scale: Tens to hundreds of thousands of files without loading everything into the UI at once.
- Safety: Never modify or delete user audio without an explicit confirmed action. Metadata never writes into source files in v1.
- Privacy: Local-first; no account for core use.
- Reliability: Crash/force-quit must not corrupt the library index; analysis can resume.
- v1 quality bar: Complete Must coverage of this SPEC plus the Claude Design surfaces, usable for daily dogfood on your library. Analysis, fuzzy search, and watch edge cases may be imperfect. Ship Must coverage, then tune from dogfood.
- Implementation bias: Prefer maintained Rust crates and existing React packages when they fit (audio I/O, decode, FS watch, SQLite, BPM/key, table virtualization, i18n). Custom code for product glue and UI chrome; avoid reimplementing OS integration or DSP that a crate already does well.

---

## 6. JIT clip cache (summary)

| Decision | Rule |
|----------|------|
| Location | App cache dir; path in settings |
| Lifetime | Until user clears cache |
| Format | WAV, exact source rate/bit depth/channels |
| Naming | `{originalName}_clip_{start}-{end}.wav`; bounds in seconds with decimals (e.g. `1.250-3.000`); unique suffix if needed |
| Metadata | No embedded cue/BPM/key from the app |

---

## 7. vs ADSR Sample Manager

Keep the feel of: dark dense browser; tags + search chips; list + detail waveform; favorites; BPM/key/tags in list; drag to DAW; overrides.

Skip in v1: store and login. Also skip live preview FX dials and MIDI mode.

Add / differ: multi-root folders → search chips; row waveforms; play-from-cursor; selection → JIT clip; half/double BPM and relative-key toggles; analysis never blocks; continuous watch with visible progress; sticky tag rejects + custom analysis; tag management; missing-file handling; metadata undo.

---

## 8. Open items

1. Exact BPM/key crate choice after a short spike (`stratum-dsp` first candidate)
2. Windows validation (v1 can be macOS-first on this host; Windows before calling cross-platform done)

---

## 9. Revision history

| Version | Date | Notes |
|---------|------|-------|
| 0.1.x | 2026-09-21 | Requirements gathering |
| 0.2.x | 2026-09-21 | Design + engineering tidy; continued Q&A |
| 0.3 | 2026-09-21 | Named Sift; Q49-Q68 folded in; Q&A paused; cleanup + humanize |
| 0.3.1 | 2026-09-22 | Locale + theme token separation (Q70); column sort cycle (Q71); taxonomy + v1 bar + crate bias (Q72-Q74) |
