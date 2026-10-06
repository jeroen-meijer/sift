# Codebase review (October 2026)

Full read of the repository at commit `60cf5df` (after 0.5.2). Covers Rust (`src-tauri/src`), the React app (`src/`), tooling, CI, and docs. Written so another developer or agent can pick up any item cold: each finding has a location, the problem, why it matters, the fix, and how to verify it.

No builds or tests ran during this review (no `node_modules` in the review checkout, and the Tauri Linux deps were not installed). Every claim below comes from reading the code. Items marked "verify" need a quick check before you act on them.

Clean-end-state findings follow the repo rule in [AGENTS.md](../../AGENTS.md#prefer-clean-end-state): fix at the owner, delete the old path, no shims. Severity labels: `high` / `medium` / `low` for bugs and performance, `must-fix` / `should-fix` / `nit` for structure.

## How to use this doc

- Work top to bottom inside each section. Bugs first, then performance, then structure, then docs and tooling.
- Several items share a root cause. The [suggested order](#suggested-implementation-order) at the end groups them so you only touch each area once.
- Every fix needs a test at the cheapest layer that can fail it ([testing.md](../reference/testing.md)). Each finding names one.
- Every PR updates `CHANGELOG.md` → `## Upcoming` in end-user wording.

## 1. Bugs

### B1 (high) Opus files are indexed but can never decode

Where: `src-tauri/src/indexer.rs` (`AUDIO_EXTS` includes `opus`), `src-tauri/Cargo.toml` (`symphonia = { features = ["all"] }`), `src-tauri/Cargo.lock`.

Problem: `Cargo.lock` has no Opus codec (`symphonia-codec-opus` or `symphonia-adapter-libopus`). Symphonia 0.6 `all` does not ship one. `.opus` files land in the library, then every decode fails: no waveform, no analysis, no preview, no JIT clip. The spec lists Opus as a Must format (§3, §4.15), and [tech-stack.md](../reference/tech-stack.md) already says to use `symphonia-adapter-libopus`.

Fix: add `symphonia-adapter-libopus` and register it with the codec registry used by `open_audio` (build a `CodecRegistry` with the default codecs plus the adapter instead of `symphonia::default::get_codecs()`). If the adapter is not acceptable (C dependency), remove `opus` from `AUDIO_EXTS` and from the spec until it is. Do not keep both.

Verify: Rust test that decodes a short `.opus` fixture under `testdata/` through `decode_file`.

### B2 (high) Undecodable files loop through analysis forever

Where: `src-tauri/src/analyze/mod.rs` (`analyze_sample`, `list_analysis_queue_ids`, `filter_analysis_queue_ids`, `analysis_worker`), `src-tauri/src/commands/mod.rs` (`get_peaks`), `src/components/SampleTable.tsx` (peaks effect), `src/components/App.tsx` (`library-changed` handler).

Problem: when `open_audio` or `decode_all` fails, `analyze_sample` returns `Ok(())` without touching `analyzed_at`. The worker still pushes a `library-changed` row change for that id. The UI marks the row's peaks stale and patches the row, which changes `samples`, which reruns `requestVisible`, which calls `get_peaks`, which finds no peakfile and enqueues the sample at the front of the queue again. While a broken file (corrupt WAV, Opus per B1, HE-AAC) is on screen, the app decodes it about every 1.5 s, and the status bar flickers "analyzing 1". Off screen it is still re-queued on every launch, every reindex and every watch auto-index, because `analyzed_at IS NULL`.

Fix: record the failure. Add a column (for example `analysis_error TEXT` plus the `mtime_ms`/`size_bytes` it failed at) or set `analyzed_at` together with an error marker. Skip such rows in the queue filters until size or mtime changes. Return a distinct "unreadable" peaks state so the row draws a broken-file placeholder instead of requesting again. Only push a row change when something was actually written.

Verify: Rust test: a garbage `.wav` file goes through `analyze_sample` once, then `list_analysis_queue_ids` no longer returns it; touching the file's mtime brings it back.

### B3 (high) "Re-analyze" from the context menu does not re-analyze

Where: `src/components/LibraryView.tsx` (`runAction` → `analyze(ids, null)`), `src-tauri/src/analyze/mod.rs` (`analyze_sample`: `peaks_only = Normal && analyzed_at.is_some()`), `src-tauri/src/meta_source.rs` (`should_write`).

Problem: the menu sends `custom = null`, which becomes `AnalyzeMode::Normal`. For any sample analyzed before, Normal mode only rebuilds the peakfile and technical columns. BPM, key, type and path auto-tags are never recomputed. Even if they were, `should_write` refuses same-rank writes, so a new `audio` BPM can never replace an old `audio` BPM. Changing the BPM range in Settings and then re-analyzing changes nothing. Spec §4.7: normal re-analyze "refreshes technical info and non-overridden auto fields".

Fix: split the mode by intent. `AnalyzeMode::Background` (first analysis and stale peakfiles, current Normal behavior), `AnalyzeMode::Reanalyze` (user asked: recompute and allow same-or-lower rank to rewrite `audio`/`filename` values, never touch `user`, re-apply non-rejected path tags), `AnalyzeMode::Custom(opts)`. Pass the rewrite rule into `should_write` as a policy instead of a `force: bool`. Delete the unused `reanalyze_samples` command in the same change (see C2).

Verify: Rust test: seed a sample with `bpm_source = "audio"`, run Reanalyze with a different BPM range, assert the BPM changed; seed `bpm_source = "user"`, assert it did not.

### B4 (high) Custom analysis is silently dropped when the sample is already queued

Where: `src-tauri/src/analyze/mod.rs` (`push_jobs`).

Problem: the queue dedupes by `sample_id` only. If a sample is already pending (launch backfill, watch, a visible row), a later Custom job for the same id hits `!st.active.insert(sample_id)` and `continue`s. The user's "Re-run BPM / key / type / overwrite tags" request never runs and nothing tells them.

Fix: when the id is already pending, upgrade the queued job's mode to the stronger one (Custom beats Reanalyze beats Background) instead of skipping. If the id is in a worker right now, queue a follow-up job. Keep this in `push_jobs` so every enqueue path gets it.

Verify: unit test on `push_jobs`: queue Background for id 1, then Custom for id 1, assert one job with Custom mode.

### B5 (high) Error toasts never show

Where: `src/lib/errorToastStore.ts`, `src/components/ErrorToast.tsx`, every `catch(console.error)` in `src/components/*` (57 call sites).

Problem: `showAppError` is exported but no product code calls it. The toast component is mounted and subscribes to a store nobody writes. Every failed action (play, add folder, drag, tag edit, purge) only logs to the devtools console. CHANGELOG 0.5.1 says "failed actions show a short error toast with a copyable code", which is not true.

Fix: route invoke failures through one place. Add a `reportError(err)` helper next to `parseInvokeError` that calls `showAppError(parseInvokeError(err))` and logs. Replace user-initiated `catch(console.error)` with it. Keep background best-effort calls (prefetch, availability refresh) silent on purpose and say so in a short comment. Pair with C9 (stable error codes) so the toast has real codes to map.

Verify: Vitest component test: a rejected `ipc.addRoot` shows the toast text from `locales/en/errors.json`.

### B6 (medium) Undo and redo of tag edits lose sticky rejects and tag source

Where: `src-tauri/src/undo.rs` (`TagAdd`, `TagRemove`), `src-tauri/src/tags.rs` (`add_sample_tag`, `remove_sample_tag`), `src-tauri/src/commands/mod.rs` (`remove_sample_tag`).

Problem: removing an auto tag deletes the row and writes a `tag_rejects` entry. Undo calls `add_sample_tag`, which re-inserts it as `source = "user"` and deletes the reject. Redo calls `remove_sample_tag`, which now sees `source = "user"` and writes no reject. After remove → undo → redo, Custom analysis (overwrite off) puts the tag back, which breaks spec §4.7 "removing an auto-applied tag is a sticky rejection". The same happens in reverse for adding a previously rejected tag. Separately, the `remove_sample_tag` command pushes an undo entry even when no row existed.

Fix: make undo snapshot-based. `UndoAction::Tag { sample_id, tag_id, before: TagState, after: TagState }` where `TagState` is `Absent | Present { source } | Rejected`. One `apply_tag_state` writes exactly that state. `remove_sample_tag` returns whether it removed anything, and the command only pushes when it did.

Verify: Rust test: auto tag → remove → undo → redo → `apply_suggested_tags` without overwrite does not re-add it.

### B7 (medium) Clearing BPM records a wrong undo entry, and clearing key/type is not sticky

Where: `src-tauri/src/commands/mod.rs` (`set_sample_bpm`, `set_sample_key`, `set_sample_type`), `src-tauri/src/samples.rs` (`set_sample_bpm`, `set_sample_key`, `set_sample_type`).

Problem: `samples::set_sample_bpm(None)` writes `bpm_source = "user"` (a sticky clear), but the command records `after_source = None`. Redo then restores `(None, None)`, so the clear stops being sticky and the next analysis fills BPM again. If the sample had no BPM and no source, clearing writes `source = "user"` but pushes no undo entry. Key and type clears write `source = NULL`, so they are never sticky: analysis refills them. The three fields disagree on what "clear" means.

Fix: pick one rule (recommended: a user clear is sticky for all three, matching the `meta_source` module doc) and implement it once (see C3). Build the undo entry from what the write function actually stored, not from a parallel guess.

Verify: Rust test per field: clear → undo → redo → run Reanalyze → value stays empty.

### B8 (medium) "Ask before indexing" is bypassed for new folders, and those files are not analyzed

Where: `src-tauri/src/watch.rs` (`handle_events`, `dir_created` loop).

Problem: a new directory under a root (the usual case: unzipping or copying a pack) goes straight to `indexer::index_tree` regardless of `new_file_mode`. It also skips `notify_auto_index`, and it never calls `enqueue_unanalyzed`, because that call only happens in the `new_files` branch. The files inside then get filtered out of `new_files` as "already indexed". Result: Ask mode silently indexes whole packs, and their BPM/key stay empty until rows scroll into view or the app restarts.

Fix: collect files under created directories into the same `new_files` list (walk the new dir with the ignore set), then let the single ask/auto branch decide. One path for "new audio arrived".

Verify: Rust test around a pure function that turns debounced events into an "index plan" (extract it from `handle_events` so it is testable without a watcher).

### B9 (medium) The Ask prompt lists files the ignore list excludes

Where: `src-tauri/src/watch.rs` (`new_files` filter).

Problem: `created` paths are filtered by `skip_paths` and "not in DB", not by the ignore list. A bounce written into `Bounces/` (default ignore) shows up in the Ask toast. Clicking Index then silently drops it because `index_paths` applies the ignore set.

Fix: build the ignore `GlobSet` once per batch and filter `created` with it before the ask/auto decision. Share the matcher with the indexer (C6).

Verify: covered by the index-plan test from B8.

### B10 (medium) "Notify me" for auto-indexed files does nothing

Where: `src-tauri/src/watch.rs` emits `auto-indexed`; `src/components/App.tsx` never listens. Setting: `notify_auto_index` in `SettingsView.tsx`.

Problem: the Settings toggle has no visible effect. Spec §4.12 lists the notification toggle as part of Auto-index.

Fix: listen for `auto-indexed` in `App.tsx` and show a short toast ("Indexed N new samples in Folder"), reusing `groupByFolder`. If the product no longer wants it, delete the setting, the event, and the spec line instead.

Verify: browser E2E or Vitest: emit the mocked event, assert the toast.

### B11 (medium) Column resize writes to the database on every mouse move

Where: `src/components/SampleTable.tsx` (resize `pointermove` → `onColumnWidthsChange`), `src/components/LibraryView.tsx` → `onSettingChange("column_widths")` → `ipc.setSetting`.

Problem: each pointer move during a resize sends an IPC call and an SQLite upsert, about 60 per second. Column reorder already uses a draft and commits on pointer up; resize does not.

Fix: keep a draft width map in `SampleTable` during the drag (like `draftOrder`) and call `onColumnWidthsChange` once on pointer up.

Verify: Vitest: simulate a drag, assert `onColumnWidthsChange` fired once.

### B12 (medium) Tag chips ignore theme palettes and can lose contrast on Snow (verify visually)

Where: `src-tauri/src/db/taxonomy.rs` (root tags seeded with hex colors), `src-tauri/src/samples.rs` (`load_tags_for` resolves inherited color), `src/lib/tagColors.ts` (`tagPalette`, `paletteFromHex`).

Problem: every default root tag is seeded with a hard-coded hex, and Rust sends each chip its inherited color. So `tagPalette(path, storedColor)` always takes the custom-hex branch for the default taxonomy, and the theme tokens `--color-tag-{drums,synths,…}-*` never apply. `paletteFromHex` mixes text toward white (`fg = mix(rgb, white, 0.62)`), which reads light-on-light on Snow's `#f7f9fc` ground. `ROOT_SLUG` also misses seeded roots (Bass, Guitar, Strings, Brass, Woodwinds, Piano). This breaks the "theme colors only in token files" rule.

Fix: see C10 for the ownership change. Short version: seed roots with a palette slug, not hex; resolve inheritance in the UI from the tag tree; build custom-hex chips with CSS `color-mix()` against theme variables.

Verify: open a library on Snow and compare chip contrast before and after. Add a Vitest for `tagPalette` choosing the token palette for a seeded root.

### B13 (low) JIT clips are not bit-exact for 16- and 24-bit sources (verify)

Where: `src-tauri/src/audio/jit.rs` (`write_wav`).

Problem: the spec says JIT WAVs match the source "exactly. No quality loss" (§4.6). Symphonia converts integer PCM to f32 by dividing by 2^(N-1) (32768 for 16-bit). `write_wav` multiplies by `i16::MAX` (32767) and by `2^23 - 1`. For samples with |v| ≥ 16384 (16-bit), the round trip lands one LSB low. Verify the Symphonia divisor first.

Fix: for WAV and AIFF sources, copy the integer frames without a float round trip (read with `hound` or slice raw frames). For decoded formats, scale by 2^(N-1) and clamp, which is the exact inverse of Symphonia's conversion.

Verify: Rust test: render a clip from a 16-bit fixture covering full scale and compare the samples to the source slice.

### B14 (low) Clear cache shows one folder and clears another

Where: `src/components/SettingsView.tsx` (JIT cache row shows `stats.clips_dir` and `stats.clips_bytes`), `src-tauri/src/audio/jit.rs` (`clear_default_clips_cache`).

Problem: after you move the clip folder, the row shows the custom path and its size, but "Clear cache" only empties the default folder (by design since 0.5.1, so a user folder is never wiped). Clicking it changes nothing on screen.

Fix: delete only files Sift created (`*_clip_*.wav` names from `allocate_clip_path`) in the active folder, so the button does what the row shows and never touches other files. Delete `clear_default_clips_cache` and its test for the old rule, add a test for the new one.

Verify: Rust test: a custom folder with one clip and one unrelated file; clear removes only the clip.

### B15 (low) Moving a missing file back can leave it "not missing but not playable"

Where: `src-tauri/src/samples.rs` (`update_path`), `src-tauri/src/indexer.rs` (`apply_directory_path_change`).

Problem: `update_path` sets `missing = 0` but leaves `availability` as is. A row marked missing (availability `missing`) that comes back through a rename event shows as present, but play and waveforms check `availability == "local"` and refuse it. Root cause is duplicated state (C5).

Fix: fold into C5. Until then, `update_path` should re-classify availability from the filesystem.

### B16 (low) Path auto-tagging mislabels common filename words

Where: `src-tauri/src/analyze/mod.rs` (`PathTokenAnalyzer`).

Problem: the token `key`/`keys` maps to `Synths/Keys`, so `Bass_Loop_120_Key_Am.wav` gets a Synths tag. `open` maps to `Drums/Hats/Open` (`open_pad.wav`), `hit` to `FX/Impact` (`snare_hit.wav`), `shot` to one-shot.

Fix: drop `key` (the key parser already consumes it), and require a drum context for `open`/`closed`/`hit` (another drum token in the path). Move the token table to data next to the taxonomy (C13) so the rules live in one place.

Verify: extend the `token_*` tests with these filenames.

### B17 (low) Smaller correctness issues

- `src-tauri/src/analyze/enrich.rs` `refresh_metadata_all`: one `enrich_sample` error aborts the loop with `?` and leaves the status bar open (no `work::finish`). Log and continue per sample; always finish the bar.
- `src-tauri/src/samples.rs` `sample_meta_snapshot_full`: `map_err` turns every DB error into `SAMPLE_NOT_FOUND`. Use `.optional()?` and map only `None`.
- `src-tauri/src/fs_ready.rs` `Availability::parse`: stored `unknown` parses as `Local`, while commands compare the string to `"local"` and treat `unknown` as not local. Analyze would decode a row that play refuses. Fixed by C5.
- `src-tauri/src/splice/catalog.rs` `try_open_ro`: builds a `file:` URI from `path.display()` without escaping. Paths with `?`, `#` or `%` fail to open. Percent-encode the path.
- `src-tauri/src/library.rs` `remove_root`: leaves `favorite_folders` rows under the removed root.
- `src/components/LibraryView.tsx` `selectedTagPath`: both ternary branches return `omni.tagsInclude[0] ?? null`. Collapse it.
- `src/components/App.tsx`: `listOutputDevices` runs once at boot, so the device picker never shows a newly plugged interface. Refetch when Settings opens.
- `src-tauri/src/audio/player.rs` `list_devices`: returns the English name `"Default"` to the UI. Return an id only and let the locale file name it (spec §4.14).

## 2. Performance

### P1 (high) Tag colors cost one or more queries per chip on every list load

Where: `src-tauri/src/samples.rs` (`load_tags_for` → `tags::resolve_color`).

Problem: for every chip without its own color (most child tags), `resolve_color` walks parents with one `SELECT` per level, inside the list query, under the DB mutex. A 25,000-row list with a few tags each runs tens of thousands of extra queries. The facet cache (P5) repeats it up to three more times. `play_sample` pays it too (P2).

Fix: stop sending color per chip. The UI already loads the tag tree (`list_tags`), so resolve inheritance there once per tree load (C10). If the backend must resolve, load all tags once into a `HashMap` per call.

Verify: `perf_*` budget test: `list_samples` on a seeded DB of 20k rows with tags under a fixed time; count queries with a Diesel instrumentation hook if helpful.

### P2 (high) Select→play does a full row load with tags before decoding

Where: `src-tauri/src/commands/mod.rs` (`play_sample`, `prefetch_decode`, `get_peaks`, `render_jit_clip`, `snap_zero_crossings` all call `samples::get_sample`).

Problem: these hot paths only need `path`, `missing`/`availability`, `sample_type` and `duration_ms`, but `get_sample` loads every column plus tags plus color resolution (P1). That is extra DB-lock time on the latency path the spec cares most about (§4.3).

Fix: add one narrow query, `samples::playable(conn, id) -> Option<Playable { path, availability, sample_type, duration_ms }>`, and use it on all five paths.

### P3 (high) Peakfiles are read and written one float per syscall, then sent as JSON

Where: `src-tauri/src/audio/peaks.rs` (`read_peakfile_inner`, `write_peakfile`, `peakfile_complete`), `src-tauri/src/commands/mod.rs` (`get_peaks`), `src/lib/rowPeaks.ts`, `src/lib/ipc.ts` (`PeakData`).

Problem: reads use `read_exact` on an unbuffered `File` for each `f32` (about 4,096 reads for a stereo 1,024-bucket file). Writes call `write_all` per float on an unbuffered `File`, then `sync_all` (an fsync per peakfile, for a cache that can be rebuilt). The result goes over IPC as JSON number arrays (about 4,096 floats plus 4,096 bytes as text, tens of KB per row) and is kept in JS as plain arrays (the cache comment estimates 50 KB per entry, 75 MB at cap). Rows are 18 px tall and about 180 px wide but get 1,024 buckets.

Fix, in order of payoff:

1. Read the whole file with `fs::read` and parse with `chunks_exact`. Build the write buffer in memory and write it once. Drop `sync_all` (keep the temp file plus rename).
2. Return the peakfile bytes as a binary IPC response (`tauri::ipc::Response`) and parse with `Float32Array`/`Uint8Array` views in JS. Store typed arrays in the row cache.
3. Serve rows a smaller bucket count (for example 256, downsampled at read time) and keep full resolution for the detail pane.

Verify: extend `perf_*` with a peakfile read budget; Vitest for the binary parser against a fixture produced by the Rust writer.

### P4 (high) Splice lookup hashes every non-Splice file under a global lock

Where: `src-tauri/src/splice/catalog.rs` (`lookup`, `file_sha256_hex`), called from `analyze::enrich::enrich_sample` for every analyze job and from `refresh_metadata_all` for every sample.

Problem: on a path miss, `lookup` computes a full-file SHA-256 while holding the process-wide `CATALOG` mutex. Users with Splice installed hash every sample that is not in Splice (most of a typical library), and the four analyze workers serialize on that lock. Each file is read twice (hash, then decode). When no catalog was found, `lookup` re-runs detection (`refresh_catalog_status`) on every call.

Fix: compute the hash outside the lock. Store it in a new `samples.content_hash` column with the size and mtime it was computed at, so each file is hashed once per change. Cache the "no catalog" result for the session, and re-detect only on `splice_catalog_status` or when the setting turns on.

Verify: Rust test: two lookups of the same unchanged file hash once (inject a counter or check the stored column).

### P5 (medium) Filter facets fetch the whole library as rows

Where: `src/lib/useFacetCache.ts`, `src/components/LibraryView.tsx` (`facetBpms`, `facetRootCounts`, `facetTagCounts`).

Problem: opening a BPM, key or tag editor runs a full `list_samples` with `limit: 25000`, up to three in parallel (one per active chip), each carrying every row's tags and colors (P1). The UI then counts in JS. All of that only produces a histogram and two count maps.

Fix: add a `facet_counts(query, omit)` command that returns `{ bpm_values or bpm_histogram, key_root_counts[12], tag_counts }` using `GROUP BY` in SQLite, with ancestor credit computed in Rust. Keep the cache keyed by query, but the payload drops from megabytes to a few KB. While there, derive `facetListCacheKey` from the query object minus `sort_*`/`offset` instead of a hand-maintained field list.

Verify: Rust test of `facet_counts` against a seeded DB; Vitest that the hook calls the new command.

### P6 (medium) Startup and every auto-index scan all peakfiles while holding the DB lock

Where: `src-tauri/src/analyze/mod.rs` (`enqueue_unanalyzed` → `db.with_conn(|conn| list_analysis_queue_ids(...))` → `peaks::has_current_peakfile` per row; same in `filter_analysis_queue_ids`).

Problem: for each local sample, a `stat` plus `open` plus header read happens inside the `with_conn` closure. On a 100k library that is 100k file opens with the UI's DB lock held, at launch and after every watch auto-index.

Fix: load `(id, analyzed_at)` under the lock, release it, then check peakfiles. Better: record the peakfile version in the DB (`peaks_version` column written by the analyzer) so the queue query needs no filesystem access at all. Merge the two near-identical queue functions (C7).

### P7 (medium) Main-thread commands wait on the player mutex

Where: `src-tauri/src/commands/mod.rs` (`playback_state`, `set_play_region`, `stop_playback`, `pause_playback`, `resume_playback` are sync, so they run on the main thread), `PlayerEngine` behind `Mutex` in `state.rs`.

Problem: the UI polls `playback_state` every 50 ms while playing. The same mutex is held during `list_output_devices` and `set_output_device` (CoreAudio enumeration, often 50 to 200 ms) and during cold stream starts in `install_play`. During those, the main thread (which also runs AppKit input and the WebView host) blocks.

Fix: keep an `Arc<SharedPlayback>` (or an `ArcSwap` of it) readable without the engine mutex, so position, pause and region updates are atomics only. Move device enumeration out of the engine lock. Consider pushing playhead position from Rust at about 30 Hz while playing (one event) instead of polling. Smaller step: make these commands `async` with `off_main`.

### P8 (medium) Zero-crossing snap and JIT render decode the whole file again

Where: `src-tauri/src/commands/mod.rs` (`snap_zero_crossings` → `decode_file`), `src-tauri/src/audio/jit.rs` (`render_clip` → `decode_file`).

Problem: the focused sample is almost always in the decode cache (it just played), but pressing `Z` or settling a selection decodes the full file from disk again. A long loop costs hundreds of ms each time.

Fix: use `decode_cache::get_or_decode(&state.decode_cache, path)` in both. `render_clip` takes `&DecodedAudio`.

### P9 (medium) Indexing does per-file queries and walks into ignored folders

Where: `src-tauri/src/indexer.rs` (`index_tree`, `write_file_record`).

Problem: `WalkDir` has no `filter_entry`, so ignored directories (`**/.git/**`, `**/node_modules/**`, `**/Bounces/**`) are still walked file by file. The patterns match children, not the directory itself, so every child is visited and skipped. `write_file_record` runs a `SELECT` per file and an `UPDATE` per unchanged file (always touching `availability_checked_at`). The whole walk finishes before the first progress tick, so the status bar stays indeterminate on large roots. `ignore.is_match(&path_str) || ignore.is_match(path)` tests the same thing twice.

Fix: prune with `filter_entry` (test `dir/` against the set, or add `**/<name>` companions when building the set). Preload `path → (id, size, mtime)` for the root in one query, skip writes for unchanged rows, and batch the rest. Tick progress during the walk every N files.

Verify: extend `index_root_releases_lock_between_batches`; add a test that a `node_modules` subtree is never stat'ed (count via a temp tree with an unreadable file inside).

### P10 (medium) Batch edits are N separate commands and N undo steps

Where: `src/components/LibraryView.tsx` (`Promise.all(ids.map(ipc.setBpm|setKey|setType|setFavorite|addSampleTag|removeSampleTag))` in six places).

Problem: setting the type on 200 selected rows sends 200 IPC calls, takes the undo and DB locks 200 times, and creates 200 undo entries, so Cmd+Z undoes one row at a time. Spec §4.8 treats metadata edits as user actions; a batch is one action.

Fix: batch commands that take `ids: Vec<i64>` and write in one transaction, pushing one `UndoAction::Batch(Vec<UndoAction>)`. See C3 for the single field-edit API this plugs into.

Verify: Rust test: batch set type on 3 ids, one undo restores all 3.

### P11 (medium) Chips call getComputedStyle on every row render

Where: `src/lib/tagColors.ts` (`mixGround` inside `paletteFromHex`), called per chip from `SampleRowView.tsx`.

Problem: every chip with a stored color (all default tags, see B12) triggers `getComputedStyle(document.documentElement)` during render. With 80 rows and a few chips each, that is hundreds of style reads per list render.

Fix: C10 moves the mix into CSS (`color-mix()` with theme variables), which removes the JS read entirely. If JS stays, cache the ground per theme like `waveTheme()` does.

### P12 (low) Smaller performance items

- `src-tauri/src/analyze/mod.rs`: one-shots still run the full `stratum_dsp` tempo pass and then discard the BPM (`skip_audio_bpm`). Samples whose BPM and key already come from Splice or the filename (higher rank) also pay for audio analysis. Decide which fields can still be written before running the analyzer, and skip work that cannot win. A race only means skipped work, which is fine.
- `src-tauri/src/analyze/mod.rs` `analyze_sample`: `path.exists()` right before `open_audio` is a redundant stat.
- `src-tauri/src/samples.rs` `wipe_analysis_all`: deletes every `.peaks` file inside `with_conn`, holding the DB lock during thousands of unlinks. Delete files after releasing the lock, and wrap the two DB statements in one transaction.
- `src-tauri/src/audio/decode.rs` `write_technical_info`: three `UPDATE`s per sample; make it one.
- `src-tauri/src/commands/mod.rs` `db_stats`: walks the clip folder on every call (every structural refresh and every 10 s during analysis). Cache the size and update it on render and clear.
- `src/lib/loadLibrary.ts`: structural refreshes also fetch the shallow tree before the deep one. The shallow pass only helps cold start; skip it after boot.
- `src/components/LibraryView.tsx`: undo and redo refetch the whole list (`refreshSamples`). Have `undo_meta`/`redo_meta` return the affected sample ids and patch those rows.
- `src-tauri/src/commands/mod.rs` `get_peaks(wait = true)`: a fast Up/Down through unanalyzed rows parks one blocking thread per row for up to 15 s. Fixed by deleting `wait` (C8).
- `src-tauri/src/audio/player.rs` audio callback: takes an `RwLock` read per callback, and can drop the last `Arc` of a replaced buffer on the audio thread (a large free). Use `arc-swap` (or an `rtrb` handoff with the old buffer returned to the control thread). `rtrb` is already a dependency and unused (C2).
- `src-tauri/Cargo.lock`: two Symphonia versions (0.5.5 from `stratum-dsp`, 0.6.1 direct) with all codecs each. Check whether `stratum-dsp` builds with `default-features = false` without its decoder.

## 3. Clean end state and refactors

### C1 (must-fix) One availability model in Rust and TypeScript

Where: `src-tauri/src/fs_ready.rs` (`Availability`), `samples.rs`, `indexer.rs`, `commands/mod.rs`, `analyze/mod.rs`, `src/lib/ipc.ts` (`availability: string`), every `availability !== "local"` in components.

Problem: availability is a free string in the DB, DTOs and TS, with an enum on the Rust side used only for parsing. Commands compare strings (`sample.availability != "local"`), `indexer.rs` writes the literal `"missing"`, the TS type says `local | cloud | missing | unknown`, and the Rust enum has no `Unknown`.

Aim: `Availability` derives `Serialize`/`Deserialize` and a Diesel `FromSql`/`ToSql` mapping (or a `TEXT` newtype), the DTO carries the enum, TS gets a string-literal union, and every comparison uses the enum. Migrate `unknown` rows by classifying them (the launch backfill already does this) and drop the variant.

### C2 (must-fix) Delete dead code, dead tables and unused dependencies

Remove, after a final grep for callers:

- Commands never called by the UI: `reanalyze_samples` (duplicate of `analyze_samples` with `custom = None`), `reindex_all`, `set_sample_tags` (and `tags::set_sample_tags` plus `ipc.setSampleTags`), `stop_playback` (`ipc.stop` has no callers; keep it only if a stop control ships).
- Query fields: `Query.tag_path` / `SampleQuery.tag_path` (always `null`), sort column `created_at` (not in `SORTABLE`).
- DB tables `meta`, `undo_stack`, `redo_stack` (undo is in memory) with their models `Meta`, `UndoRow`, `RedoRow`, via a new Diesel migration. Drop `Serialize`/`Deserialize` on `UndoAction` if nothing serializes it.
- `#[allow(dead_code)]` items: `UndoStack::can_undo/can_redo`, `PlayerEngine::loop_preview/gain_db/seek`, the three helpers in `ids.rs`, and the stale allow on `AppPaths::cache_dir` (it is read by `profile_log::init`).
- Rename shims: `pub use work_ui as work;` (name the module `work`), `watch::looks_like_audio_path` (alias of `is_audio_file`), `errorLocaleKey` in `appError.ts` (identity function).
- Dependencies: `uuid` and `rtrb` (unused), `anyhow` with `AppError::Other` (never constructed), the Rust `tauri-plugin-drag` plugin registration, the npm `@crabnebula/tauri-plugin-drag`, and the `drag:default` capability (the app calls the `drag` crate directly from `start_drag_files`).
- `#[allow(clippy::unnecessary_wraps)]` on commands that cannot fail: return `()` instead of `AppResult<()>`. The JS `invoke` shape does not change.

### C3 (must-fix) One write path per editable sample field

Where: `src-tauri/src/commands/mod.rs` (`set_sample_favorite/bpm/key/type`), `src-tauri/src/samples.rs` (`set_sample_*` and `restore_sample_*`, six near-copies), `src-tauri/src/undo.rs`.

Problem: three commands repeat the same lock-snapshot-write-push dance with two `with_conn` calls each (not one transaction), and `samples.rs` has a `set_*` and a `restore_*` per field that differ only in the source value. The undo entry is guessed in the command (B7). `SAMPLE_NOT_FOUND` boilerplate is repeated nine times.

Aim: one `enum MetaField { Favorite(bool), Bpm(Option<f64>), Key(Option<String>), Type(Option<String>) }`, one `samples::write_meta(conn, id, field, source) -> Before` that returns the previous value and source, one `set_sample_meta(ids, field)` command that runs in a transaction and pushes one undo entry (P10). Undo and redo call `write_meta` with the stored before/after. Add one `fn ensure_updated(n: usize) -> AppResult<()>` for the not-found check. Delete `sample_meta_snapshot` (tuple) and keep one snapshot type.

### C4 (must-fix) One analysis runtime owned by AppState

Where: `src-tauri/src/analyze/mod.rs` (`analysis_runtime` `OnceLock` that ignores its arguments after first call, `worker_gate` `OnceLock`, `ANALYZE_PCM` static), every `enqueue_*`/`spawn_analysis_batch` call site passing `(app, db.clone(), peaks_dir.clone())`.

Problem: callers thread three handles through every call only so the first one can lazily start a global. There are five public entry points (`spawn_analysis_batch`, `enqueue_unanalyzed`, `enqueue_ids`, `enqueue_priority`, `analyze_now`) for one queue.

Aim: `AnalysisQueue` struct created in `AppState::init`, started in `setup`, exposing `enqueue(ids, mode, priority)` and `enqueue_needing_work(scope)`. Mode upgrade (B4) and failure tracking (B2) live inside it.

### C5 (must-fix) Drop the `missing` column; availability is the single source

Where: migration plus `samples.rs`, `indexer.rs`, `library.rs`, `analyze/*`, `SampleDto.missing`, `SampleRow.missing`, every `row.missing` in the UI.

Problem: `missing INTEGER` and `availability = 'missing'` encode the same fact and are kept in sync by hand in a dozen writes. B15 is one desync already.

Aim: delete `missing`, derive `missing` in the UI as `availability === "missing"` (or keep a computed DTO field only if it really reads better). Replace `idx_samples_missing` with an index on `availability`. Lands after or with C1.

### C6 (should-fix) Merge the indexer's three write loops and the three index-job spawners

Where: `src-tauri/src/indexer.rs` (`index_root`, `index_tree`, `index_paths` each reconcile then write in `INDEX_BATCH` chunks), `src-tauri/src/commands/mod.rs` (`add_root`, `reindex_root`, `reindex_all` each spawn a thread, start the work bar, index, finish, push `library-changed`, enqueue analysis).

Aim: one `write_records(db, root_id, records) -> written` used by all index paths, and one `spawn_index_job(app, IndexScope::{Root(id), All})` in commands. Share one ignore matcher (B9, P9).

### C7 (should-fix) Collapse duplicated decision logic

- `analyze/mod.rs` `write_creative_fields` repeats the same filename-then-audio candidate selection three times (BPM, key, type), and `enrich.rs` `apply_hit` repeats a Splice version three times. One generic `pick_candidate(current, sources, policy)` used by both.
- `meta_source.rs`: `rank()` and `rank_self()` restate the discriminants. Derive `Ord` on `MetaSource` and compare `Some(incoming) > MetaSource::parse(stored)`.
- `analyze/mod.rs`: `list_analysis_queue_ids` and `filter_analysis_queue_ids` share the "needs work" predicate. One function with an optional id filter.
- `src/components/WaveformView.tsx` `snapDivisor` and `LibraryView.tsx` `snapSecs` both map snap modes to divisors. One `lib/snap.ts`.
- `src/components/App.tsx`: `refreshLibrary(); setRefreshToken(n => n + 1)` appears five times, and `LibraryView` has its own `reload`. One `libraryEpoch` store that every consumer reads (tree, tags, list, facets, focused row), bumped in one place.
- `PREFETCH_MAX_DURATION_MS` lives in both `LibraryView.tsx` and `commands/mod.rs`. The backend already filters; delete the UI copy.
- `src/lib/omni.ts`: `OPTIONAL_COLUMNS` restates the `OptionalColumn` union. Derive the type from the array (`as const`).

### C8 (should-fix) One way for the detail pane to get peaks

Where: `src-tauri/src/commands/mod.rs` (`get_peaks` `wait` flag, `DETAIL_PEAKS_WAIT`), `src-tauri/src/analyze/mod.rs` (`analyze_now`, the `finished` condvar), `src/components/LibraryView.tsx` (the `rowChangesStore` subscriber that already refetches peaks for the focused sample).

Problem: two mechanisms deliver the detail waveform: a blocking wait inside `get_peaks`, and the `library-changed` event the UI already handles. The wait parks a thread per selection (P12).

Aim: delete `wait`, `analyze_now`, `DETAIL_PEAKS_WAIT` and the `finished` condvar. The detail pane calls `get_peaks` (priority enqueue) and relies on the existing event refetch.

### C9 (should-fix) Stable error codes at the source, no string sniffing

Where: `src-tauri/src/error.rs` (`code_and_detail` maps `Message` by `s.contains("missing")`), `error_codes.rs` (most codes unused in Rust), `AppError::msg` calls across commands.

Problem: "missing audio codec params" or "drag path missing" come out as `sample.missing_file`, and most real failures come out as `error.generic`. This is a per-symptom string rule at the serializer instead of a code where the error is created.

Aim: construct `AppError::coded(...)` at each user-facing failure (play refused, sample missing, online-only, drag failed, add root refused, device not found). Delete the substring mapping. Keep `Message` for internal errors that map to `error.generic`. Pair with B5.

### C10 (should-fix) One owner for tag colors

Where: `src-tauri/src/db/taxonomy.rs`, `src-tauri/src/samples.rs` (`TagChip.color` and `resolve_color`), `src-tauri/src/tags.rs` (`resolve_color`), `src/lib/tagColors.ts`, `src/styles/tokens.css`.

Aim: a tag's `color` is either `null` (inherit), a palette slug (`drums`, `synths`, …) or a custom `#rrggbb`. Seed roots with slugs. The UI resolves inheritance from the tag tree it already has (one pass per tree load, kept in a map by tag id). Chips render with CSS: slug → `var(--color-tag-<slug>-*)`, custom hex → `color-mix(in srgb, var(--color-tag-mix-ground) 66%, <hex>)` for the ground and a theme-aware ink. Delete `TagChip.color` from the DTO and both `resolve_color` functions. Add slugs for every seeded root. Fixes B12, P1 and P11 together. Needs a migration that rewrites the seeded root hex values to slugs only when they still equal the seed (so user picks survive).

### C11 (should-fix) One musical-key model per language, and a canonical stored key

Where: Rust `samples.rs` (`normalize_key_token`, `pitch_class`, `spellings_for`, `relative_of`), `analyze/name_meta.rs` (`parse_root`, `format_key`), `splice/map.rs` (`normalize_root`, `flat_to_sharp`); TS `lib/keys.ts` (`MusicalKey`, `normalizeKeyToken`, `keyMatchesStored`) and `lib/omniKey.ts` (`OmniKey`, `parseOmniKey`, `storedKeyToOmni`).

Problem: three key parsers in Rust and two key models in TS. The stored `key_name` has no canonical form (filename parse, Splice mapping and `stratum_dsp`'s `key.name()` can each produce different spellings; verify the stratum format), so the search query expands enharmonics in SQL with `lower(replace(key_name, ' ', ''))`, which no index can use.

Aim: one Rust `MusicalKey { pitch_class: u8, minor: bool }` with `parse` and `Display`, used by every producer. Store canonically (either one spelling, or `key_pc INTEGER` + `key_minor INTEGER` columns). Search becomes `key_pc IN (...) AND key_minor = ?`. In TS, keep `OmniKey` and delete the parallel `MusicalKey` helpers, moving any UI-only helpers (suggestions) onto `OmniKey`.

### C12 (should-fix) Split the two god files

- `src-tauri/src/commands/mod.rs` (1,275 lines, every domain): split into `commands/{library,samples,playback,tags,analysis,clips,profile}.rs`, re-exported from `mod.rs`. Do this after C2/C3/C6 so dead commands do not move.
- `src/components/LibraryView.tsx` (1,406 lines: list fetching, focused row, playback transport and playhead polling, selection, keyboard map, drag, clip render, dialogs, batch actions). Extract hooks with one job each: `useSampleList`, `useFocusedSample`, `usePreviewTransport`, `useLibraryKeyboard`, `useClipRender`, `useSampleActions`. The component keeps layout and wiring. `OmniSearch.tsx` (775) and `SettingsView.tsx` (690) are the next candidates.

### C13 (should-fix) Default settings and default taxonomy have one source each

- Settings defaults live in Rust `db/settings.rs` (`ensure_defaults`) and again in TS `DEFAULT_SETTINGS` (`ipc.ts`). They already drift: TS `ignore_list: []` vs Rust `DEFAULT_IGNORE`, and TS lacks `locale`. The UI already waits for `loaded`. Make settings `AppSettings | null` until loaded (or have Rust return the full typed object), and delete `DEFAULT_SETTINGS`.
- The taxonomy lives in `db/taxonomy.rs`, again as path strings in `PathTokenAnalyzer`, and in [default-taxonomy.md](../reference/default-taxonomy.md). Keep one data file (for example `src-tauri/src/db/taxonomy.toml` with paths, slugs and token synonyms), load it in Rust, and have the doc link to it instead of restating it.

### C14 (should-fix) Theme previews read the tokens instead of copying them

Where: `src/theme/index.ts` (`THEME_INFO` swatches and `waveBands` hex values duplicated from `tokens.css`), `src/lib/waveTheme.ts` fallbacks.

Problem: the picker repeats every theme's colors in TS, which breaks the "colors only in token files" rule and drifts when a token changes.

Aim: render each preview card inside an element with `data-theme="<id>"` and let swatches and the preview wave read `var(--…)`. Keep only the id list in TS. Also drop the `dark-default` alias in both `normalizeThemeId` and the CSS selector: rewrite the stored setting once on load (or in a migration) and delete the alias.

### C15 (nit) Smaller cleanups

- `src/components/SampleTable.tsx`: three profile-only effects (scroll, virtual range, void) live in the product component. Move them to one `useScrollProfiler(scrollRef, virtualItems)` hook so the table reads as a table.
- `src-tauri/src/commands/mod.rs` `start_drag_files`: a blocking `rx.recv()` inside an `async` command occupies a runtime thread for the whole drag on Windows. Use a `tokio::sync::oneshot` and `.await` it.
- `src-tauri/src/watch.rs`: `skip_paths` grows for the life of the process. Clear entries when the file is removed, or cap it.
- Hard-coded colors in component CSS (`shell.css` `#e81123`/`#fff`, `library.css` tooltip `#fff` on `rgba(0,0,0,.72)`, many `rgb(0 0 0 / 72%)` shadows). Move them to `--shadow-*` and `--color-*` tokens so Snow can soften them.
- `scripts/tauri-profile.ts` is the only file in `scripts/`. Move it into `tool/` and update `package.json` and the profiling doc.
- `tool/` mixes `kebab-case.ts` and `snake_case.sh`. Pick one style when you next touch those files.
- `src-tauri/tauri.conf.json` has `"csp": null`. Set a strict CSP (`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'` plus what Tauri IPC needs). Cheap hardening for an app that renders user file names.
- Column visibility (`hiddenColumns`) is not persisted except the wave column via `row_waveforms`. Either persist it as one setting or document that it resets per launch.
- Changing the ignore list does not affect already indexed samples. Decide the product rule (offer "remove now-ignored samples" or reindex) and write it into spec §4.1.

## 4. Docs

### D1 (must-fix) The spec no longer describes the product

Where: [spec.md](../spec.md).

Stale or contradicted: header says version 0.3.1, "Stack: Undecided" and "Q&A paused"; §2 and §4.13 say dark only and "do not invent light mode", but four themes ship including the light Snow theme; §8 lists the BPM/key crate as open, but `stratum-dsp` is in use. Missing behavior that shipped: Splice catalog metadata and its precedence (`meta_source.rs` documents a rank order nobody else does), spectral waveform coloring, Date added / Date created columns, overlap refusal on add folder, library recovery after a failed migration, in-app updates, the source column. §4.11 still frames search as "no query language" while [omni-search-spec.md](../design/omni-search-spec.md) replaced that.

Fix: bump the version, update the header, fold each shipped behavior into the matching section, add a "metadata precedence" subsection (user > Splice > filename > audio, sticky clears), and record the settled questions in [decisions.md](../decisions.md). Fold the behavioral parts of `omni-search-spec.md` into §4.11 and delete that file (it is a behavior spec, not design).

### D2 (must-fix) tech-stack.md describes plans, not the stack

Where: [tech-stack.md](../reference/tech-stack.md).

Stale: "working recommendation, not a locked ADR until a spike confirms"; "spike before locking" section; suggested `src/themes/dark-default.css` layout (real: `src/styles/tokens.css` with `[data-theme]` blocks); `tauri-plugin-fs` listed but unused; `rtrb` recommended but unused; Opus adapter recommended but not added (B1); doc history says "keep cpal/symphonia/rusqlite" next to the Diesel entry; "egui fallback" framing.

Fix: rewrite as a current-state reference: what each crate does here, where it lives, and the real file layout. Move history to git.

### D3 (must-fix) Remove stale design gap lists and the finished plan

- [v1.2-gaps.md](../design/v1.2-gaps.md) says "everything below is still open", but Settings is a full view, tag rename/move/color are wired, the remove-missing dialog, empty state and selection bar all exist. [v1.1-gaps.md](../design/v1.1-gaps.md) is the pass before it. Re-check the few items that may still be open, move those to [feature-catalog.md](feature-catalog.md) or [known-issues.md](../known-issues.md), and delete both files.
- [plans/](../plans/README.md) is a finished v1 phase plan ("implementation complete"). Git history keeps it. Delete the folder and its row in [docs/README.md](../README.md).
- [large-collection-profiling.md](large-collection-profiling.md) (1,300+ lines) mixes conclusions with run logs. Distill the durable rules (budgets, profiling workflow, what caused which hitch) into a short `reference/performance.md`, link it from AGENTS, and cut the research file to evidence worth keeping or delete it.

### D4 (should-fix) AGENTS.md carries canonical release detail

Where: [AGENTS.md](../../AGENTS.md) "Changelog / release" (release assets, signing, updater URL, badge URLs, voice rules).

Problem: [docs/README.md](../README.md) says AGENTS.md is a pointer, yet this section is the only copy of the release pipeline and changelog voice rules, and [commits-and-pull-requests.md](../reference/commits-and-pull-requests.md) points back to AGENTS for them.

Fix: move it to `docs/reference/releasing.md` (pipeline, assets, signing, updater) and the changelog voice rules into `commits-and-pull-requests.md`. Leave three pointer lines in AGENTS.

### D5 (should-fix) CHANGELOG claims a feature that is not wired

CHANGELOG 0.5.1 says failed actions show an error toast (B5). When B5 lands, the Upcoming bullet should describe it as a fix ("failed actions show an error message again" or "now show"), since 0.5.1 shipped without it.

### D6 (nit) Keep known-issues current

[known-issues.md](../known-issues.md) has a long dated status log under the row-flash entry. Keep each entry to the current symptom and next step; the history is in git. Add B2 there if it is not fixed soon, since users with corrupt files will see it.

## 5. Tests and CI

### T1 (should-fix) macOS-only code is never compiled in CI

Where: `.github/workflows/ci.yml` (Ubuntu only), `src-tauri/src/commands/mod.rs` (`drag_gesture_is_live` with `objc2`), `src-tauri/src/fs_ready.rs` (`UF_DATALESS`), `src-tauri/src/fs_dates.rs` (`getattrlist` FFI).

Problem: the main platform's `cfg(target_os = "macos")` code only gets compiled on a developer machine. Clippy, the unsafe FFI and the drag guard can break without CI noticing.

Fix: add a `macos-latest` job that runs `cargo clippy --all-targets --all-features -- -D warnings` (and nextest if time allows). Keep Ubuntu for the fast path.

### T2 (should-fix) E2E coverage is a single smoke test per mode

Where: `e2e/specs/browser/smoke.spec.ts`, `e2e/specs/tauri/smoke.spec.ts`.

Add browser-mode specs (mocked `invoke`) for the flows that broke or are about to change: search chip editors and facets (P5), context-menu re-analyze and custom analysis (B3, B4), tag picker batch edit plus undo (B6, P10), error toast on a rejected command (B5), Ask toast grouping (B8, B9). Add `bun run typecheck:e2e` to the frontend CI job so the harness does not rot.

### T3 (should-fix) Tests to add with the fixes

Each bug above names its test. On top of those:

- Peakfile round trip: Rust writer to the new binary IPC parser in Vitest (P3).
- A `perf_*` budget for `list_samples` with tags on a 20k-row seeded DB (P1, P2), and for `list_analysis_queue_ids` without filesystem access (P6).
- Undo/redo property test over random sequences of field edits and tag edits, checking that undo-all returns the exact starting row and tag state (B6, B7, C3).

## Suggested implementation order

Grouped so each area is opened once. Each group is one PR-sized change with its own Upcoming bullet.

1. Dead code and deps (C2). Small, removes noise for everything after it.
2. Analysis correctness: B2, B3, B4, C4, C8, P6, P12 analyzer skips. All in `analyze/` and the queue.
3. Opus support (B1), alone, because it adds a dependency.
4. Metadata writes and undo: C3, B6, B7, P10, plus the batch UI changes in `LibraryView`.
5. Availability model: C1, C5, B15.
6. Tag colors: C10, B12, P1, P11, C14.
7. Peaks pipeline: P3 (buffered IO, binary IPC, row bucket count), P2, P8.
8. Watch and indexer: B8, B9, B10, C6, P9.
9. Errors: C9 then B5.
10. Search facets: P5, then the 25,000-row list cap from known issues (windowed list).
11. Splice: P4 and the B17 Splice items.
12. Structure: C11, C12, C13, C15.
13. Docs: D1 to D6 (D1 and D2 can go any time; update them in the same PR as the behavior they describe when possible).
14. CI and tests: T1 and T2 early if you want CI to catch regressions from the steps above.

## Coverage

Read in full: every file under `src-tauri/src` except the test bodies of `name_meta.rs`, `fs_dates.rs`, `perf_budgets.rs` and `benches/` (skimmed); `src/components/App.tsx`, `LibraryView.tsx`, `SampleTable.tsx`, `RowWaveform.tsx`, `WaveformView.tsx` (first half), `src/lib/*` data and IPC modules, `src/theme/index.ts`; migrations; capabilities; CI workflows; `tool/preflight.sh`; `docs/README.md`, `spec.md`, `known-issues.md`, `reference/tech-stack.md`, `reference/testing.md`, `reference/commits-and-pull-requests.md` (first half), design and plans indexes.

Skimmed by search only: `OmniSearch.tsx`, `SettingsView.tsx`, `DetailPane.tsx`, `FolderSidebar.tsx`, `TagManagerView.tsx`, `ui/*`, omni editors, CSS files (searched for hard-coded colors), release scripts under `tool/`, `research/*` except the headers.
