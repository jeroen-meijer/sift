## Upcoming

- fix: fix white flash and wrong initial screen at startup, caused by showing the window before theme and library roots were ready

## 0.3.1

- fix(library): fill Date added and Date created on launch for samples indexed before those columns existed
- fix(ui): bring back the X of Y count on the bottom-right Processing bar

## 0.3.0

- feat(library): match Splice Desktop's local catalog for BPM, key, and loop/one-shot; Source column with a fixed Splice badge; Date added (macOS) and Date created
- feat(analyze): peaks-only repairs and catalog enrich without a full decode, so fixing waveforms does not wipe BPM/key/type
- feat(settings): Refresh metadata and a full-library re-analyze that wipes analysis data first; indexing, availability checks, and Refresh share the bottom-right Processing bar
- fix(library): BPM 0 means no BPM; Clear BPM sticks so Splice and analyze do not refill it
- feat(wave): four-band spectral colors (bass, low-mid, high-mid, treble) so brighter pads can shift hue
- fix(wave): rebuild peakfiles when the on-disk format is older
- ci: run PR checks on Ubuntu with Bun and Rust caches; pin Bun 1.4.2
- ci: leave Apple signing identity unset when the secret is empty so unsigned macOS publish works

## 0.2.0

- feat(library): metadata-first browse for cloud libraries (Online only badges, analyze when files hydrate to local)
- feat(library): show the whole library when no folder is selected; arrow keys keep selection in view; Show parent folder clears filters and reveals the sample
- feat(sidebar): nested folder tree with caret expand/collapse (animated), folder context menu, and Expand All / Collapse All
- feat(analyze): BPM and key from filenames when present (`140BPM`, `_174_`, `F#min`, `(D)`); prefer over audio
- feat(analyze): row peakfiles and a shared analyze queue with status-bar progress; resume pending work on launch
- feat(detail): truncated title and library-relative path with hover; right-click the filename for the sample context menu
- feat(table): drag-reorder columns (persisted), widths that scale with the pane, spectral bass/mid/treble waveform coloring
- feat(search): multi-word query matches in any order; highlight every matched word
- fix(ui): 32px overlay titlebar so macOS traffic lights sit with the chrome; text selection off by default (detail path/name stay selectable)
- fix(detail): keep the detail pane on the sample you picked when a filter drops it from the list; clear if the sample is deleted
- perf(library): smoother large libraries (coalesced refresh, in-place row patches, virtualized folder sidebar, list when browsing)
- perf(table): scroll without blank strips or delayed tags; reuse row DOM and keep cached waveforms
- perf(audio): decode cache with a byte budget; prefetch neighbors of the focused sample
- perf(analyze): memory and CPU caps (PCM budget, QoS, fewer workers while the app is focused)
- chore(ci): GitHub Actions publish for macOS and Windows installers

## 0.1.0

- feat: initial Sift desktop app (Tauri 2 + React). Browse, audition, tag, and drag local samples into a DAW.
