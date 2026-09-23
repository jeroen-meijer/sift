## Upcoming

- feat(analyze): guess BPM and key from filenames (`140BPM`, `_174_`, `F#min`, `(D)`); prefer over audio when present
- feat(sidebar): ease-out 180ms expand/collapse row animation (respects reduced motion)
- fix(sidebar): tree-sort so "FX One Shots" does not sit inside the "FX" subtree; expand one level; Alt-click / menu Expand All · Collapse All
- fix(sidebar): nest folder children under their parent (was sorted by depth, caret looked expanded with no kids below)
- feat(sidebar): folder context menu (reveal, copy, favorite, expand/collapse, re-index / remove root)
- fix(sidebar): even row heights (no root overlap); caret expand/collapse for nested folders; drop folder icons
- fix(detail): truncate long sample titles with end ellipsis; hover shows the full name in a dark chip
- fix(detail): show library-relative path truncated at the start; hover copy control for the full path
- perf(analyze): Low QoS on analyze/index threads; 2 workers while focused, 4 when not
- fix(library): arrow keys scroll selection into view; showParent clears filters and reveals the sample
- feat(library): list the whole library when no folder is selected (limit 25k); center empty state
- fix(ui): default user-select none; keep path/name in the detail pane selectable
- perf(analyze): shared ~1 GiB PCM budget (replaces the one-at-a-time large-file lock)
- perf(audio): decode cache evicts by byte budget (~256 MB), not entry count
- fix(table): drop lite/fast-scroll mode (tags were delayed); overscan 40; keep cached waves while scrolling
- fix(table): keep cached row waveforms while scrolling fast (do not clearRect on lite/paint budget); overscan 28; void marks ignore rubber-band scrollTop
- perf(table): light rows (text only) while scrolling fast, full rows ~140 ms after; static SVG row icons instead of icon components; row lines drawn as a repeating tile behind the list
- fix(detail): the detail pane stays on the sample you picked when a search, folder or tag change filters it out of the list; it updates if the file goes missing and clears if the sample is deleted
- fix(search): match every word of the query in any order (`cw amen`, `amen cw`, `cw am` all find `cw_amen_…`); `%` and `_` are literal; highlight every matched word
- perf(table): overscan 20 so fast flicks do not show an empty strip; recycled rows repaint in the same frame; fetch row peaks while scrolling (6 in flight)
- fix(analyze): browsing never decodes on its own; rows without a peakfile jump the analyze queue and the detail pane waits for its sample, so every decode shows in the status bar; changed files re-analyze through the queue
- perf(table): reuse row DOM and canvases while scrolling; overscan 40 then 6; paint row waves in one budgeted frame pass with cached theme colors
- perf(library): coalesce `library-changed` (one per 1.5 s, structural vs row ids); patch changed rows in place; skip full list and folder tree refetch; virtualize the folder sidebar
- perf(ui): analyze progress and playhead live in small stores; memoized sidebar, table rows, detail pane and status bar
- perf(ipc): run DB, disk and decode commands off the main thread; play/stop carry a sequence so the last selected row is the one that plays
- perf(analyze): cap memory: pre-sized decode buffer, one long file at a time, one shared mono buffer, 60 s analysis excerpt for long files
- perf(library): `folder_tree` from grouped rows; availability and technical refresh `stat`/decode outside the DB lock
- chore(profile): buffered profile log on its own thread, `ipc.emit` counts, `fe.list_ipc`/`fe.list_commit`/`fe.render` marks, Web Inspector in profile builds, `tool/memwatch.sh`
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
