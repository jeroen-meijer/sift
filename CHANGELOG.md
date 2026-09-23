## Upcoming

- fix(analyze): single shared queue and status bar; keep a fixed worker pool
- feat(library): backfill sample availability on launch; enqueue analyze when files hydrate to local
- feat(analyze): build row peakfiles during analysis; resume queue on launch (status bar while metadata/waveforms pending)
- perf(library): metadata-first browse for large Dropbox libraries (DB folder tree, Online only badges, local-only analyze pool, gated peaks/play)
- feat(table): drag-reorder columns with FLIP animation; persist `column_order`
- feat(table): scale column widths with the pane (`fr` weights + min floors)
- perf(audio): decode LRU cache and reuse converted PCM for preview seeks
- perf(library): prefetch decode for focused neighbors; coalesce list_samples
- feat(waveforms): spectral bass/mid/treble coloring with theme band hues
- chore(ci): GitHub Actions publish for macOS and Windows installers

## 0.1.0

- feat: initial Sift desktop app (Tauri 2 + React). Browse, audition, tag, and drag local samples into a DAW.
