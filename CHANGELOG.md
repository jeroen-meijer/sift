## Upcoming

- feat(wave): four-band spectral colors (bass, low-mid, high-mid, treble) so brighter pads can shift hue instead of staying one mid green
- fix(wave): rebuild peakfiles when the on-disk format is older (v6 left rows blank after the four-band bump)
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
