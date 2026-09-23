# Known issues

Open problems found while dogfooding. Newest first. Remove an entry when its fix lands (mention the fix in `CHANGELOG.md`).

## Arrow keys do not scroll the selected row into view

Found 2026-09-23. Moving the selection with the up/down arrows past the edge of the visible rows keeps playing each sample, but the table does not scroll, so you lose sight of what is playing.

- Where: the `selectDown` / `selectUp` handler in `LibraryView.tsx` only sets `focusedId` and `selectedIds`.
- Fix direction: `SampleTable` exposes a `scrollToIndex` (the virtualizer's `scrollToIndex(index, { align: "auto" })`), and the arrow handler calls it with the new index. `align: "auto"` only scrolls when the row is outside the view, so moving inside the view stays still.

## "Show only files from parent folder" loses the sample

Found 2026-09-23. The context-menu action sets the folder filter but keeps the current search text, and does not show the sample you clicked, so it looks like the sample disappeared.

- Where: `case "showParent"` in `LibraryView.tsx` does `setOmni((prev) => ({ ...prev, folder: sample.parent_path }))`.
- Expected: clear the search (and other filters), select that folder in the sidebar and scroll the sidebar to it, keep the sample focused and selected, and scroll the table so the sample's row is visible once the folder list loads.

## Empty "Select a folder" view instead of the whole library

Found 2026-09-23. With no folder, tag or search selected, the table shows "Select a folder". It should list all samples from all roots.

- The empty view was added on purpose in the metadata-first work, when listing 5,000 rows took 0.6 to 1.8 s. The Phase A run measured 123 ms IPC and 7 ms render for 5,000 rows, so that reason is gone.
- Catch: `list_samples` is capped at `limit: 5000`; the library has 20,439 samples. Showing "all" needs either a higher limit (measure the IPC time for ~20k rows first) or the windowed list (D3 in the V3 spec).

## Labels and other UI text can be selected

Found 2026-09-23. Dragging over UI text (for example the empty-state message in the sample table) highlights it like page text. Only a few places are already `user-select: none` (`library.css`, `detail.css`, `shell.css`).

- Expected: text is not selectable by default, like a native app. Opt back in only where copying makes sense: the file path and name in the detail pane, and text inputs.
- Fix direction: `user-select: none` on the app shell root in `base.css`, then `user-select: text` on those few elements. Inputs and textareas stay selectable.

## Row waveforms flash grey or blank while scrolling fast

Found 2026-09-23 during the Phase A profile run, scrolling the full `samples` folder (5,000 rows) with waveforms on.

**Status 2026-09-23 (afternoon):**

- **Regression fixed:** paint-budget no longer `clearRect`s a correct wave.
- **Lite/fast-scroll mode removed:** it hid tags/icons until ~100 ms after scroll and felt like pop-in. Full rows always.
- Overscan **40**; peaks prefetch pad 12; canvas `willReadFrequently`.
- **Profiling voids:** `fe.void_scroll` / `fe.void` / `fe.scroll` (`gap=`). In a recent dogfood stretch, `gap` stayed 0 while chrome still “popped” — that was lite mode, not missing rows. If voids remain with `gap=0` after a restart, check WebKit Layers (checkerboarding).
- Hard flicks can still show one frame of empty row *lines* (browser vs React); row-line tile mitigates black void.

## Analyze runs one file at a time on long samples

Found 2026-09-23 during the Phase A profile run (see [LARGE_COLLECTION_PROFILING_V3.md](LARGE_COLLECTION_PROFILING_V3.md)).

- The analyze pool lets only one "large" file (over 8 M interleaved samples, about 90 s of stereo 44.1 kHz) be decoded at a time, to cap memory. While the queue works through long files, only one of the 4 workers does anything: about 1 file per second, CPU near 100 % (one core).
- The files that just finished downloading from Dropbox are mostly 4 to 6.5 minutes long (11 to 17 M frames), so this stretch is long. The earlier claim that 98 % of the library is under 60 s was measured on files that were already analyzed, so it missed these.
- Memory stayed well under the old 12 GB (peak 782 MB during the long-file stretch, 1,320 MB once when a 17-minute file overlapped other jobs), so the lock is stricter than it needs to be for 4 to 6 minute files.
- Fix direction: replace the one-at-a-time lock with a memory budget. Each job reserves its expected PCM size (frames × channels × 4 bytes, plus the mono copy) from a shared budget of about 1 GB, and waits only if it does not fit. Four 5-minute files fit at once; the 38-minute file runs alone. Streaming analyze (D2) removes the need for the budget.

## "Select a folder" empty state is not centered

Found 2026-09-23. The empty-state message in the sample table (magnifier icon, "Select a folder", indexed count) sits left of the table's center.

- Not investigated yet. Likely cause: `.sample-table-empty` is absolutely positioned inside the virtual list's inner container in `SampleTable.tsx`, so it centers on that element rather than on the visible table area. Check this before changing anything.
