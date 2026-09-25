# Large collection profiling V3: UI performance implementation spec

This doc turns an earlier profiling pass and a profile run (`logs/sift-profile.log`, ~18:47 to 19:00 on 2026-09-22) into ordered work items. The previous pass recorded what shipped. This one replaces its "Build next" plan.

Test machine: M2 Max, 12 cores, 32 GB. Library: 20 439 samples, 2 817 distinct folders, 13 986 peakfiles (272 MB on disk). 98 % of files are under 60 s. 183 are over 1 min; 3 are over 10 min (longest 38 min).

Priority: input and scroll must not stall; memory needs a fixed ceiling; background analyze throughput is last.

---

## Status (handoff, 2026-09-23)

Phase A is on `main` (`06e1107`). Same-day follow-ups also landed: known-issues UX fixes, analyze PCM budget (A5), decode-cache byte budget (B2), and C1 QoS. For open bugs and what to profile next, see [known-issues.md](../known-issues.md).

### Phase A: implemented (A1 to A7) and profiled once

Results from the Phase A run (`logs/sift-profile-phaseA.log`, `logs/sift-mem-phaseA.log`):

| Metric | Before (V2 run) | Phase A |
| --- | --- | --- |
| FPS during analyze, no folder open | 3 to 11 | 60 |
| Row wave paint max | 225 to 270 ms | 1 ms |
| `fe.get_peaks` p90 | 990 ms | 6 ms |
| Peak queue wait p90 | ~60 s | 78 ms |
| 5,000-row list (IPC / render) | 0.6 to 1.8 s | 123 ms / 7 ms |
| Peak memory during analyze | ~12 GB (RSS) | 1,320 MB footprint (782 MB typical) |
| `library-changed` | ~50 tree rebuilds / min | 4 to 5 per 10 s |

Differences from the spec below:

- A7 Step 3 uses a slot allocator (`src/lib/rowSlots.ts`), not `index % N` (the modulo version reused nothing; a test caught it).
- `fe.render` comes from `useRenderTiming` (React's `<Profiler>` reports nothing in release builds).
- The midpoint profile run was skipped; A1 to A7 landed together.
- Analysis rule: `get_peaks` never decodes. Rows without a peakfile get `bucket_count: 0` and jump the analyze queue (priority lane, `enqueue_priority`); the detail pane waits for its sample via `analyze_now` (up to 15 s). Watcher content changes delete the peakfile and re-queue. Every decode runs in the analyze pool, so an empty status bar means nothing is left to analyze.
- `tool/memwatch.sh` uses `top`, not `vmmap` (vmmap suspends the process ~0.8 s per sample and caused fake hitches).

### Changes after Phase A (same day, from dogfooding)

- Scrolling: overscan 20; recycled rows repaint in the same frame (`paintNow`, 10 ms budget, `src/lib/paintQueue.ts`); peaks fetched while scrolling, 6 in flight; row lines drawn as a 28 px repeating tile (`.sample-table-rows`); light rows (text only) above 3 px/ms scroll speed, full rows 140 ms later; static SVG row icons (`RowIcons.tsx`); `contain: layout paint` on rows. Overscan must stay constant (shrinking it unmounts rows and recreates canvases).
- Search: every word must appear in the filename, any order; `%`/`_` literal; all matched words highlighted (`src/lib/searchHighlight.ts`).
- Detail pane stays on the picked sample when a search, folder or tag change filters it out; updates if it goes missing, clears if deleted. Folder/tag clicks no longer clear it.

### Where it stands

- Wave disappear / delayed tags (2026-09-23): lite/fast-scroll mode removed (it delayed tags ~100 ms and cleared waves). Paint budget no longer blanks a correct wave. Overscan 40.
- Void / pop-in: marks `fe.void_scroll`, `fe.void`, `fe.scroll` (`gap=`). A recent stretch had `gap=0` while chrome still popped. That was lite mode. Restart once so HMR is clean, then re-check.
- Memwatch (`sift-mem` tmux): idle footprint ~290 to 330 MB.

---

## Contents

1. [Verdict](#verdict)
2. [Evidence](#evidence)
3. [Research notes](#research-notes)
4. [Corrections to V2](#corrections-to-v2)
5. [Ground rules for implementing](#ground-rules-for-implementing)
6. [Phase A: measure, free the main thread, stop refetching and canvas churn](#phase-a-measure-free-the-main-thread-stop-refetching-and-canvas-churn) (A1 to A7)
7. [Phase B: row peaks and decode cache](#phase-b-row-peaks-and-decode-cache) (B1, B2)
8. [Phase C: background work tuning](#phase-c-background-work-tuning) (C1, C2)
9. [Phase D: last resorts, each on its own trigger](#phase-d-last-resorts-each-on-its-own-trigger) (D1 to D3)
10. [Success bar](#success-bar)
11. [Decisions taken](#decisions-taken)

---

## Verdict

The V2 P0 list helps scrolling a little. It misses the four biggest costs:

1. Every Tauri command in `src-tauri/src/commands/mod.rs` is a plain sync `fn`. Tauri 2 runs those on the app main thread, which also runs AppKit input and the WebView host.
2. Analyze progress events (4 to 5 per second) and playhead frames (60 per second) re-render the whole library view, including a 2 817-row sidebar that is not virtualized.
3. A new row canvas costs ~240 ms to paint. Repainting an existing canvas costs ~0 ms. Index-keyed rows plus `ROW_OVERSCAN=40` create canvases nonstop while scrolling.
4. Memory has no ceiling. Each analyze job holds the whole file as interleaved `f32` PCM, then makes up to 3 more mono copies, and stratum-dsp builds a full-length STFT. A 5 s one-shot is fine. The 38-minute file costs several GB, and 4 workers can hit long files at the same time.

---

## Evidence

Percentiles from `logs/sift-profile.log`, computed numerically (76 678 lines).

| Mark | n | p50 | p90 | max | Note |
| --- | ---: | ---: | ---: | ---: | --- |
| `ipc.get_peaks` | 938 | 2.1 ms | 2.6 ms | 5.7 ms | Rust body |
| `fe.get_peaks` | 936 | 6 ms | 990 ms | 2 456 ms | Same calls seen from JS |
| `fe.peaks_start` (queue wait) | 936 | 22.8 s | 59.6 s | 65 s | Rows wait tens of seconds |
| `ipc.list_samples` | 60 | 46 ms | 77 ms | 128 ms | |
| `fe.list_samples` | 60 | 378 ms | 1 399 ms | 1 849 ms | |
| `ipc.folder_tree` | 550 | 67 ms | 102 ms | 199 ms | ~50 calls a minute during analyze |
| `fe.avail_refresh` | 12 | 363 ms | 864 ms | 1 228 ms | 200 `stat` calls, holds DB lock |
| `fe.row_wave_paint` | 430 | 233 ms | 246 ms | 269 ms | Bimodal, see below |
| `fe.scroll` (gap between scroll events) | 27 | 2.9 s | 7.5 s | 31.7 s | n=708 folder, `mounted=92` |
| `fe.frame` (hitches ≥ 25 ms) | 1 552 | 352 ms | 622 ms | 2 453 ms | 373 hitches ≥ 500 ms |
| `analyze.sample` | 13 821 | 62 ms | 215 ms | 98.6 s | 17 jobs over 5 s |

What the log shows:

- Low FPS with nothing on screen: minutes 0 to 7 have `fe.fps` 3.2 to 11.5 and zero `fe.list_*`, `fe.peaks_*` or `fe.scroll` marks. No folder was open. Only `folder_tree` refreshes and progress events ran.
- Bimodal canvas paint: 209 paints at 0 to 2 ms, 221 paints at 225 to 270 ms (53.6 s total). Painting the same id again: 241 ms first, 0 ms after.
- The IPC gap is main-thread time. `get_peaks` p50 is 6 ms from JS when nothing blocks; p90 is 990 ms when something does. The Rust body never takes more than 6 ms.
- `fe.list_apply` is mislabeled. It measures `await ipc.listSamples()`, not the React commit. `fe.list_apply_commit` runs in a microtask before React commits, so its 0.2 ms means nothing.

### Code causes, with locations

| # | Cause | Where |
| --- | --- | --- |
| 1 | All commands sync, so they run on the main thread | [commands/mod.rs](../src-tauri/src/commands/mod.rs) |
| 1a | `folder_tree` loads all 20k `(root_id, parent_path, path)` rows; `path` unused | [library.rs:118](../src-tauri/src/library.rs#L118) |
| 1b | `refresh_availability_for_paths` runs `stat` inside `with_conn` | [samples.rs:535](../src-tauri/src/samples.rs#L535) |
| 1c | `prefetch_decode` decodes 4 files while holding the `decode_cache` lock | [commands/mod.rs:534](../src-tauri/src/commands/mod.rs#L534) |
| 1d | Profile log: unbuffered write + `flush()` + `eprintln!` per line, one mutex shared with 4 workers | [profile_log.rs:80](../src-tauri/src/profile_log.rs#L80) |
| 1e | One `Mutex<SqliteConnection>` for UI reads, 4 workers and the watcher | [db/mod.rs:80](../src-tauri/src/db/mod.rs#L80) |
| 2 | `analysis-progress` handler sets state in `App` | [App.tsx:127](../src/components/App.tsx#L127) |
| 2a | `setPlayhead` on every rAF in `LibraryView` | [LibraryView.tsx:297](../src/components/LibraryView.tsx#L297) |
| 2b | `library-changed` calls `bump()`, which refetches stats, tree, tags, full list | [App.tsx:104](../src/components/App.tsx#L104) |
| 2c | Every favorite / BPM / key / tag edit calls `reload`, which refetches list and tree | [LibraryView.tsx](../src/components/LibraryView.tsx) `toggleFavorite`, `runAction`, `setBpmOn` |
| 2d | `FolderSidebar` renders all 2 817 folders, not memoized | [FolderSidebar.tsx](../src/components/FolderSidebar.tsx) |
| 3 | Row keyed by index; canvas unmounted whenever peaks are null; `clientWidth` + 2 × `getComputedStyle` per paint | [SampleTable.tsx](../src/components/SampleTable.tsx), [RowWaveform.tsx:61](../src/components/RowWaveform.tsx#L61) |
| 3a | Prefetch effect builds `new Map(samples.map(...))` over the whole list on every range change | [SampleTable.tsx:229](../src/components/SampleTable.tsx#L229) |
| 3b | `PeakData` sent as JSON, ~50 KB per row, stored as JS `number[]` | [peaks.rs:32](../src-tauri/src/audio/peaks.rs#L32), [ipc.ts:70](../src/lib/ipc.ts#L70) |
| 4 | `decode_file` grows `Vec<f32>` with no reserve | [decode.rs:98](../src-tauri/src/audio/decode.rs#L98) |
| 4a | Mono copies: `detect_loop_or_oneshot`, `HeuristicAnalyzer`, `mix_to_mono` (peaks), plus stratum's own `samples.to_vec()` | [analyze/mod.rs:262](../src-tauri/src/analyze/mod.rs#L262), [peaks.rs](../src-tauri/src/audio/peaks.rs) |
| 4b | stratum-dsp STFT over the full file (38 min ≈ 196k frames × 1 025 bins × 4 B ≈ 800 MB) | `stratum_dsp::analyze_audio` |
| 4c | `DecodeCache` capped at 16 entries, not bytes | [decode_cache.rs:15](../src-tauri/src/audio/decode_cache.rs#L15) |

---

## Research notes

- **Tauri command threads.** "Commands without the async keyword are executed on the main thread unless defined with `#[tauri::command(async)]`." Async commands run on `async_runtime::spawn`. Blocking work inside them belongs on `tauri::async_runtime::spawn_blocking` (tauri 2.11.6 has it; the `JoinHandle` resolves to `tauri::Result<T>`). [v2.tauri.app/develop/calling-rust](https://v2.tauri.app/develop/calling-rust/)
- **Binary IPC.** Serde return values are serialized to JSON. `tauri::ipc::Response::new(Vec<u8>)` arrives in JS as an `ArrayBuffer` from `invoke<ArrayBuffer>(...)`. Same link.
- **TanStack Virtual.** Default `overscan` is 1. `virtualizer.isScrolling` resets 150 ms after the last scroll event. Default `getItemKey` is the index. [tanstack.com/virtual/latest/docs/api/virtualizer](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- **Canvas-heavy grids.** [Glide Data Grid](https://github.com/glideapps/glide-data-grid) draws the visible grid into one canvas. The cheaper step first: recycle DOM rows by slot so each canvas survives scrolling.
- **Web Inspector in release builds.** Tauri's `devtools` Cargo feature enables the inspector outside debug builds. [v2.tauri.app/develop/debug](https://v2.tauri.app/develop/debug/)
- **SQLite WAL.** Readers do not block the writer and the writer does not block readers, but only across separate connections. [sqlite.org/wal.html](https://www.sqlite.org/wal.html)
- **macOS QoS.** Background work belongs at `utility` QoS so the scheduler favors the UI. [Apple: Prioritize work with QoS](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/PrioritizeWorkWithQoS.html). `thread-priority` 3.x only handles nice/realtime on unix, not QoS. [`qos-threads` 0.1.3](https://docs.rs/qos-threads/latest/qos_threads/) wraps it safely: `set_current_thread(Qos::Low)` maps to `QOS_CLASS_UTILITY` and is a no-op on Windows.
- **Memory numbers on macOS.** `ps -o rss` counts pages freed with `MADV_FREE_REUSABLE` until the kernel takes them back, so RSS can stay high after frees. `vmmap --summary <pid>` prints `Physical footprint` and `Physical footprint (peak)`, which is what Activity Monitor shows. Allocator swaps have their own macOS retention issues ([microsoft/mimalloc#1025](https://github.com/microsoft/mimalloc/issues/1025)).
- **moodbar-analysis 0.7.1** ([gildesmarais/moodbar.rs](https://github.com/gildesmarais/moodbar.rs)) already streams internally (`FrameAnalyzer::feed_mono_samples`, then `finish`), but only exports `analyze_pcm_mono(rate, &[f32], &opts)`, which needs the whole mono signal.
- **stratum-dsp 1.0.0** `analyze_audio(&[f32], rate, config)` copies its input (`samples.to_vec()`) and computes an STFT over all of it. Its memory scales with input length, so cap the input.
- **symphonia 0.6.** `Track::num_frames: Option<u64>` is known after probe for WAV/AIFF/FLAC and most MP3s, before any packet is decoded.
- Wave Silo, ADSR and similar: no public write-up of internals found. Drop the V2 sentence that claims they "do the same shape."

---

## Corrections to V2

- "P0 memory: check allocator retention." Replaced by A5 (and D2 if needed): bound the working set by design, and measure with `vmmap --summary`, not `ps`.
- "Cap list page size (~200 to 500)" as P0. The metric behind it is the IPC wait, and scroll also lagged at n=708. Moved to D3 with a trigger condition.
- "Pause peaks enqueue while scrolling." Kept inside B1. It is not the root cause.
- "1 to 2 analyze workers while focused" as a UI fix. 4 workers use 4 of 12 cores; minutes 0 to 7 were re-renders and main-thread IPC. Kept in C1 as a memory and QoS measure.
- Missing from V2: A3, A4, the sidebar and edit-reload parts of A6, the canvas cause in A7, the memory mechanism in A5 and D2, C2.

---

## Ground rules for implementing

- Phases: implement every item in a phase, then run the phase check (one profile run as described in [Success bar](#success-bar)) and append a dated results table to the end of this doc. The check says whether the next phase is needed. Stop as soon as the success bar is met.
- Order inside a phase is the listed order. Items in a phase are small enough to ship as one PR each.
- Why this order: Phase A removes every cost the log pins down (main-thread blocking, app-wide re-renders, memory peaks, the refetch storm, the 240 ms canvas cost). It has one profile run in the middle to record what the first five items fixed, but no stop there. Phase B and C depend on the numbers after A. Phase D items are larger or riskier and have their own triggers.
- Changelog: fold user-visible outcomes into `CHANGELOG.md` → `## Upcoming` (merge with related unshipped bullets; no one-line-per-item diary).
- Code sketches show shape, not final code. The crate denies `as` conversions, indexing, `unwrap` and unchecked arithmetic: use `crate::ids` helpers, `.get()`, `checked_*`/`saturating_*`, and `unwrap_or_else(PoisonError::into_inner)` for locks, like the existing code.
- Every item must keep `cargo clippy --all-targets --all-features -- -D warnings`, `cargo nextest run`, `bun run lint`, `bun run typecheck`, `bun run test` green.

Size key: S under half a day, M one to two days, L three days or more.

| Phase | Items | Size | Risk | Needed? |
| --- | --- | --- | --- | --- |
| A | A1 profiling, A2 quick fixes, A3 commands off main thread, A4 no app-wide re-renders, A5 memory ceiling, midpoint profile run, A6 refresh storm, A7 canvas reuse | ~7 to 9 days | Low to medium (A3 changes call ordering, A6 patches rows in place, A7 recycles rows; each item covers its cases) | Always |
| B | B1 binary batched row peaks, B2 decode cache by bytes | ~2 days | Medium (new wire format) | If waves still fill slowly or memory grows while scrolling or auditioning |
| C | C1 QoS and focus-aware workers, C2 SQLite read connection and one UPDATE | ~2 days | Low to medium | If scrolling still drops frames during analyze, or UI reads wait on analyze writes |
| D | D1 one wave canvas, D2 streaming analyze, D3 windowed list | L each | Medium to high | Only on each item's trigger |

---

## Phase A: measure, free the main thread, stop refetching and canvas churn

Goal: remove every cost the log pins down. That is main-thread blocking and app-wide re-renders (A3, A4), multi-GB memory peaks (A5), the library refetch storm (A6), and canvas creation while scrolling (A7). A1 and A2 come first because every later check uses A1's numbers and A2 is five safe one-liners. All items are low risk except A3, A6 and A7; each covers its own edge cases.

---

### A1. Profiling you can trust (S)

Do first. Every later item is checked with these numbers.

**Files:** `src-tauri/src/profile_log.rs`, `src-tauri/Cargo.toml`, `scripts/tauri-profile.ts`, `src/components/LibraryView.tsx`, `src/lib/profile.ts`, new `tool/memwatch.sh`.

**Steps:**

1. `profile_log`: replace the `Mutex<File>` with a channel to one writer thread.

 ```rust
 static TX: OnceLock<std::sync::mpsc::Sender<String>> = OnceLock::new();

 pub fn init(cache_dir: &Path) {
 // ...open file as today...
 let (tx, rx) = std::sync::mpsc::channel::<String>();
 std::thread::Builder::new()
 .name("sift-profile-log".into())
 .spawn(move || {
 let mut w = std::io::BufWriter::with_capacity(64 * 1024, file);
 let echo = std::env::var_os("SIFT_PROFILE_STDERR").is_some();
 while let Ok(line) = rx.recv() {
 if echo { eprint!("[sift-profile] {line}"); }
 let _ = w.write_all(line.as_bytes());
 // Drain whatever is already queued, then flush once.
 while let Ok(more) = rx.try_recv() {
 let _ = w.write_all(more.as_bytes());
 }
 let _ = w.flush();
 }
 })
 .ok();
 let _ = TX.set(tx);
 }

 fn write_line(msg: &str) {
 if let Some(tx) = TX.get() {
 let _ = tx.send(format!("{}\t{}\n", now_ms(), msg));
 }
 }
 ```

2. Add a Cargo feature so profile builds get Web Inspector without shipping it:

 ```toml
 [features]
 profile = ["tauri/devtools"]
 ```

 In `scripts/tauri-profile.ts` spawn `bunx tauri dev --release --features profile`.

3. Fix the list marks in `refreshSamples`: rename `fe.list_apply` to `fe.list_ipc` (it is the IPC round trip). Add `fe.list_commit`: store `applyAt` in a ref, and in a `useEffect` keyed on `samples`, log `performance.now() - applyAt` once, then clear the ref. Delete `fe.list_apply_commit`.

4. Add `fe.render`: wrap `FolderSidebar`, `SampleTable` and `DetailPane` in `<Profiler id=... onRender=...>` only when `isProfileOn()`. Log `actualDuration` when it is ≥ 4 ms, with the id and `phase`.

5. Add Rust `ipc.emit` counters: a small `emit_counted(app, name, payload)` helper that counts per event name and logs `ipc.emit name=... n=...` every 10 s. Use it for `analysis-progress`, `analysis-queue`, `library-changed`, `index-progress`.

6. `tool/memwatch.sh`:

 ```bash
 #!/usr/bin/env bash
 # Usage: tool/memwatch.sh [interval_s]. Appends sift footprint to logs/sift-mem.log
 set -euo pipefail
 pid=$(pgrep -f 'target/release/sift' | head -1)
 while kill -0 "$pid" 2>/dev/null; do
 fp=$(vmmap --summary "$pid" 2>/dev/null | grep -E '^Physical footprint' | tr -s ' ' | paste -sd' ' -)
 echo "$(date +%T) $fp" >> logs/sift-mem.log
 sleep "${1:-5}"
 done
 ```

**Verify:** a profile session writes the same marks as before with no `[sift-profile]` stderr spam. Right-click to Inspect Element works in `tauri:profile`. `logs/sift-mem.log` shows current and peak footprint.

---

### A2. Quick fixes (S)

Five small changes with no behavior change, in one PR. Each removes a measured cost.

1. **`ROW_OVERSCAN` 40 to 6** in `src/components/SampleTable.tsx`. Mounted rows drop from ~92 to ~32, so ~60 % fewer canvases and peak fetches per scroll.
2. **Remove the full-list `Map` in the prefetch effect** (`SampleTable.tsx`, `availabilityById = new Map(samples.map(...))`). The loops already check `sample.availability`. Pass no `availabilityById` to `prefetchRowPeaks`.
3. **`folder_tree` from grouped rows** in `src-tauri/src/library.rs`:

 ```rust
 let rows: Vec<(i32, String, i64)> = samples_dsl::samples
 .filter(samples_dsl::missing.eq(0))
 .group_by((samples_dsl::root_id, samples_dsl::parent_path))
 .select((samples_dsl::root_id, samples_dsl::parent_path, diesel::dsl::count_star()))
 .load(conn)?;
 ```

 Walk ancestors once per distinct parent (2 817 instead of 20 439) and add `n` instead of 1 to the inclusive counts. Output stays identical. Test: existing `folder_tree` tests unchanged; new test with two files in one folder asserts `sample_count == 2` on the folder and its ancestors.
4. **Availability `stat` outside the DB lock** in `src-tauri/src/samples.rs` (`refresh_availability_for_paths`, `refresh_availability_all`) and `refresh_technical` (called from the watcher): one query loads `(id, path, availability, missing)` and releases the lock, then `fs_ready::classify_path` runs with no lock, then one `with_conn` transaction writes the changed rows. Today up to 200 Dropbox `stat` calls hold the lock that the UI and 4 workers need.
5. **Reserve the PCM buffer** in `src-tauri/src/audio/decode.rs`:

 ```rust
 let expected = track
 .num_frames
 .and_then(|f| usize::try_from(f).ok())
 .and_then(|f| f.checked_mul(usize::from(channels)));
 let mut samples: Vec<f32> = Vec::with_capacity(expected.unwrap_or(0));
 ```

 No doubling growth and no realloc copies when the frame count is known.

**Verify:** `ipc.folder_tree` p50 drops from 67 ms to under 15 ms. `fe.avail_refresh` no longer lines up with `analyze.sample` spikes. `mounted=` in `fe.scroll` marks is ~32. All existing tests pass.

---

### A3. Get IPC off the main thread (M)

**Why:** 40 s of `folder_tree`, every availability `stat`, `prefetch_decode` decodes and every DB mutex wait currently block AppKit input and the WebView host.

**Files:** `src-tauri/src/commands/mod.rs`, `src-tauri/src/audio/decode_cache.rs`, `src-tauri/src/samples.rs`, `src-tauri/src/state.rs`, `src/lib/ipc.ts`, `src/components/LibraryView.tsx`.

**Step 1: the helper.** In `commands/mod.rs`:

```rust
use tauri::Manager;

/// Run blocking command work on Tauri's blocking pool, never the main thread.
async fn off_main<T, F>(app: AppHandle, f: F) -> AppResult<T>
where
 T: Send + 'static,
 F: FnOnce(&AppState) -> AppResult<T> + Send + 'static,
{
 tauri::async_runtime::spawn_blocking(move || f(&app.state::<AppState>()))
 .await
 .map_err(|e| AppError::msg(format!("blocking task failed: {e}")))?
}
```

**Step 2: convert commands.** Pattern:

```rust
#[tauri::command]
pub async fn folder_tree(app: AppHandle, max_depth: Option<u32>) -> AppResult<Vec<FolderNode>> {
 off_main(app, move |state| {
 let depth = max_depth.unwrap_or(6);
 crate::profile_log::time("ipc.folder_tree", &format!("depth={depth}"), || {
 state.db.with_conn(|conn| library::folder_tree(conn, depth))
 })
 })
 .await
}
```

The JS side does not change: argument names and return shapes stay the same.

| Treatment | Commands |
| --- | --- |
| `off_main` | `get_settings`, `set_setting`, `db_stats`, `list_roots`, `add_root`, `remove_root`, `folder_tree`, `set_folder_favorite`, `reindex_root`, `reindex_all`, `list_samples`, `refresh_sample_availability`, `set_sample_favorite`, `set_sample_bpm`, `set_sample_key`, `set_sample_type`, `reanalyze_samples`, `analyze_samples`, `purge_missing`, `remove_sample`, `respond_ask_index`, `undo_meta`, `redo_meta`, `get_peaks`, `play_sample`, `prefetch_decode`, `list_output_devices`, `set_output_device`, `set_preview_gain`, `set_loop_preview`, all tag commands, `render_jit_clip`, `snap_zero_crossings`, `clear_jit_cache`, `set_clips_dir` |
| Stay sync (sub-millisecond, lock only) | `set_play_region`, `stop_playback`, `pause_playback`, `resume_playback`, `playback_state`, `profile_enabled`, `profile_log_path`, `profile_mark`, `profile_mark_batch` (cheap after A1) |
| Unchanged | `start_drag_files` (already async; it needs `run_on_main_thread` for AppKit) |

`restart_watches` inside `remove_root` runs FSEvents registration; call it from `std::thread::spawn` like `add_root` already does.

**Step 3: ordering that used to be free.** Sync commands ran one at a time on the main thread. Async ones can overlap. Three places care.

*a. Play order.* Add a request sequence from the frontend so a slow decode that finishes late cannot start playing after a newer request or a stop.

```rust
// state.rs
pub struct AppState {
 // ...
 /// Highest play/stop request seen. Late decodes with a lower seq are dropped.
 pub play_seq: std::sync::atomic::AtomicU64,
}

// commands/mod.rs: play_sample gains `seq: u64`
pub async fn play_sample(app: AppHandle, sample_id: i64, seq: u64, /* ...existing args */) -> AppResult<()> {
 off_main(app, move |state| {
 use std::sync::atomic::Ordering;
 state.play_seq.fetch_max(seq, Ordering::SeqCst);
 // ...load row, decode via decode_cache::get_or_decode (lock NOT held during decode, see c)...
 if state.play_seq.load(Ordering::SeqCst) != seq {
 return Ok(()); // superseded while decoding
 }
 state.player.lock().unwrap_or_else(PoisonError::into_inner)
 .play_decoded(path, &decoded, start, play_type, region)
 })
 .await
}

// stop_playback / pause_playback also take `seq: u64` and call fetch_max first.
```

Frontend: `ipc.ts` keeps `let playSeq = 0;` and `ipc.play`, `ipc.stop`, `ipc.pause` send `seq: ++playSeq`.

*b. Metadata edits and undo.* Take the undo lock first and hold it for the whole read-write-push, so two quick edits cannot interleave. `undo_meta`/`redo_meta` already lock undo before the DB: keep that order (undo, then DB) everywhere to avoid deadlocks.

```rust
pub async fn set_sample_bpm(app: AppHandle, id: i64, bpm: Option<f64>) -> AppResult<()> {
 off_main(app, move |state| {
 let mut undo = state.undo.lock().unwrap_or_else(PoisonError::into_inner);
 let before = state.db.with_conn(|conn| Ok(samples::sample_meta_snapshot(conn, id)?.1))?;
 state.db.with_conn(|conn| samples::set_sample_bpm(conn, id, bpm))?;
 if before != bpm {
 undo.push(UndoAction::Bpm { id, before, after: bpm });
 }
 Ok(())
 })
 .await
}
```

Same for favorite, key, type, `add_sample_tag`, `remove_sample_tag`.

*c. Decode cache lock.* Never decode while holding `decode_cache`. Split the `DecodeCache` API:

```rust
impl DecodeCache {
 /// Cached PCM if the entry exists and the mtime still matches.
 pub fn get_fresh(&mut self, path: &Path) -> Option<Arc<DecodedAudio>>;
 pub fn insert(&mut self, path: PathBuf, audio: Arc<DecodedAudio>, mtime: Option<SystemTime>);
}

/// Free function: lock, check, unlock, decode, lock, insert.
pub fn get_or_decode(cache: &Mutex<DecodeCache>, path: &Path) -> AppResult<(Arc<DecodedAudio>, bool)> {
 if let Some(hit) = cache.lock().unwrap_or_else(PoisonError::into_inner).get_fresh(path) {
 return Ok((hit, true));
 }
 let mtime = file_mtime(path);
 let audio = Arc::new(decode_file(path)?);
 cache.lock().unwrap_or_else(PoisonError::into_inner)
 .insert(path.to_path_buf(), Arc::clone(&audio), mtime);
 Ok((audio, false))
}
```

Two concurrent misses on the same path may both decode. That is acceptable and much cheaper than blocking play.

**Step 4: `prefetch_decode` scope.** It fires on every focus change and fully decodes 4 neighbors. Change the frontend to prefetch only the next row (offset +1) and only when `duration_ms` is known and ≤ 30 000. In Rust, skip rows with `duration_ms > 30_000`.

**Step 5: availability `stat` outside the DB lock.** Done in the quick fixes. For reference: in `samples::refresh_availability_for_paths`, split into three phases: one query loads `(id, path, availability, missing)` for all paths (release the lock), then `fs_ready::classify_path` for each path with no lock, then one `with_conn` transaction applies the changed rows. Apply the same split to `refresh_availability_all` and to `refresh_technical` in the watcher.

**Tests:**

- `decode_cache`: hold the `Mutex<DecodeCache>` in an `Arc`, start `get_or_decode` on a fixture in one thread, and assert `try_lock()` succeeds from another thread while the decode runs (use a test-only slow decode hook if fixtures decode too fast).
- `play_seq`: `fetch_max` with a lower seq does not lower the stored value; a play whose seq is no longer current returns without calling the player (test the check as a small pure function).
- Existing tests keep passing.

**Verify:** Instruments, Time Profiler on `sift` during an analyze wave; the main thread shows no `sift_lib::commands` frames. `fe.get_peaks` p90 drops from 990 ms to under 30 ms. Hold the down arrow in a 700-row folder with play-on-select on: the row you stop on is the one that plays.

---

### A4. Stop app-wide re-renders from high-rate state (M)

**Why:** each progress event and each playhead frame re-renders `LibraryView`, the 2 817-row sidebar, the table and the detail pane.

**Files:** new `src/lib/store.ts`, new `src/lib/useStableCallback.ts`, new `src/lib/liveStores.ts`, `src/components/App.tsx`, `LibraryView.tsx`, `SampleTable.tsx`, new `SampleRowView.tsx`, `FolderSidebar.tsx`, `DetailPane.tsx`, `WaveformView.tsx`, `StatusBar.tsx`, `RowWaveform.tsx`, `library.css`, `src-tauri/src/analyze/mod.rs`.

**Step 1: a tiny external store.**

```ts
// src/lib/store.ts
import { useSyncExternalStore } from "react";

export interface Store<T> {
 get: () => T;
 set: (next: T) => void;
 subscribe: (fn: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
 let value = initial;
 const listeners = new Set<() => void>();
 return {
 get: () => value,
 set: (next) => {
 if (Object.is(next, value)) return;
 value = next;
 for (const fn of listeners) fn();
 },
 subscribe: (fn) => {
 listeners.add(fn);
 return () => listeners.delete(fn);
 },
 };
}

export function useStore<T>(store: Store<T>): T {
 return useSyncExternalStore(store.subscribe, store.get);
}

/** Selector must return a primitive or a stable reference. */
export function useStoreSelector<T, S>(store: Store<T>, select: (v: T) => S): S {
 return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
```

```ts
// src/lib/useStableCallback.ts: same identity forever, always calls the latest fn.
import { useCallback, useLayoutEffect, useRef } from "react";

export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
 const ref = useRef(fn);
 useLayoutEffect(() => {
 ref.current = fn;
 });
 return useCallback((...args: A) => ref.current(...args), []);
}
```

**Step 2: stores.**

```ts
// src/lib/liveStores.ts
export interface AnalysisLive { bar: AnalysisBar | null; activeIds: ReadonlySet<number> }
export const analysisStore = createStore<AnalysisLive>({ bar: null, activeIds: new Set() });
/** Seconds into the playing sample, or null. Written every animation frame. */
export const playheadStore = createStore<number | null>(null);
```

- `App.tsx`: the `analysis-queue` and `analysis-progress` listeners write to `analysisStore` instead of `setAnalysisBar` / `setAnalyzingIds`. Throttle writes to at most one per 500 ms with a trailing write; write immediately when `remaining === 0`. Delete the `analyzingIds` and `analysisBar` props from `App`, `LibraryView`, and `SampleTable`.
- Rust `AnalysisProgress` gains `active_ids: Vec<i64>`: the jobs currently inside a worker, not the whole queue. Track `in_worker: HashSet<i64>` in `QueueProgress` (insert on dequeue, remove on finish). The FE stores it as `activeIds`. This fixes rows that stay "analyzing" until the whole queue ends.
- `StatusBar` reads `useStore(analysisStore).bar`.
- A row reads `useStoreSelector(analysisStore, (s) => s.activeIds.has(id))`, a boolean, so only rows whose flag flips re-render.

**Step 3: playhead without React renders.**

- `LibraryView`'s rAF loop calls `playheadStore.set(secs)` instead of `setPlayhead`. Remove the `playhead` state. Places that set it directly (`onScrubRow`, `onSeek`) call `playheadStore.set(...)`.
- New hook, used by the playing row and by `WaveformView`:

 ```ts
 /** Moves `el` by writing style directly: no React render per frame. */
 export function usePlayheadStyle(
 ref: React.RefObject<HTMLElement | null>,
 durationSecs: number,
 active: boolean,
 ): void {
 useLayoutEffect(() => {
 const el = ref.current;
 if (!el || !active || durationSecs <= 0) return;
 const apply = () => {
 const secs = playheadStore.get();
 const f = secs == null ? 0 : Math.min(1, Math.max(0, secs / durationSecs));
 el.style.transform = `translateX(${(f * 100).toFixed(3)}%)`;
 };
 apply();
 return playheadStore.subscribe(apply);
 }, [ref, durationSecs, active]);
 }
 ```

 In the row, `.row-wave-playhead` sits inside a full-width wrapper that gets translated; `.row-wave-played` becomes a full-width element scaled with `transform: scaleX(f)` and `transform-origin: left` (a second small hook or a `mode` argument). In `library.css`, replace `will-change: left` with `will-change: transform`.
- `DetailPane` / `WaveformView`: replace the `playheadSecs` prop with the same subscription. If `WaveformView` draws the playhead on its canvas, move it to a separate absolutely positioned DOM line (or overlay canvas) driven by the hook, so the main wave canvas never repaints per frame.

**Step 4: memoize the big children.**

- `export const FolderSidebar = memo(function FolderSidebar(...) { ... })`. Same for `SampleTable`, `DetailPane`, `StatusBar`, `OmniSearch`.
- In `LibraryView`, every prop passed to those must be stable:
 - Inline arrow props become `useStableCallback(...)`: `onSelectFolder`, `onSelectTag`, `onRemoveRoot`, `onHoverPreview`, `onSort`, `onColumnWidthsChange`, `onColumnOrderChange`, `onOpenMenu`, `onScrubRow`, and every `DetailPane` and `OmniSearch` callback.
 - `columnWidths={mergeColumnWidths(settings.column_widths)}` and `columnOrder={mergeColumnOrder(...)}` become `useMemo` on the settings value.
 - `columnLabels={{...}}` for `OmniSearch` becomes `useMemo` on `t`.
- New `SampleRowView = memo(...)` in `SampleRowView.tsx`, extracted from the row JSX in `SampleTable`. Props: `sample`, `index`, `top` (the `virtual.start`), `template`, `columns`, `selected`, `playing`, `showWaveforms`, `colored`, `highlightText`, `waveWidth` (A7), plus stable callbacks that take the sample (`onSelect(sample, e)`, `onOpenMenu`, `onToggleFavorite`, `onScrub`, `onHoverPreview`, `onDragStart`). `SampleTable` passes `selectedIds.has(sample.id)` as the boolean `selected`, never the Set.

**Tests:**

- `store.test.ts`: `set` with the same value does not notify; `useStoreSelector` re-renders only when the selected value changes (render counter with `@testing-library/react`).
- `SampleTable.test.tsx`: render 50 rows, update `analysisStore` for one id, assert only that row re-rendered (spy on a render counter passed through a test-only prop, or wrap with `<Profiler>`).
- Update the "swaps the tags cell for an analysing label" test to drive `analysisStore` instead of the prop.

**Verify:** React DevTools Profiler (`bun run tauri:dev`): one progress event commits only `StatusBar` and the rows whose flag changed. During playback, React commits nothing per frame. `fe.fps` median ≥ 55 during an analyze wave with no folder open. `fe.render` shows no `FolderSidebar` entries during analyze.

---

### A5. Memory ceiling for analyze (S)

**Target:** no multi-GB peaks during an analyze wave. D2 (only if needed) brings the peak under 1 GB.

**Files:** `src-tauri/src/audio/decode.rs`, `src-tauri/src/audio/mod.rs`, `src-tauri/src/analyze/mod.rs`, `src-tauri/src/audio/peaks.rs`, `src-tauri/benches/audio_hotpath.rs`, `src-tauri/src/perf_budgets.rs`, `src-tauri/src/lib.rs` (perf re-exports).

1. **Reserve the PCM buffer.** Done in the quick fixes. For reference: in `decode_file`, after picking the track:

 ```rust
 let expected = track
 .num_frames
 .and_then(|f| usize::try_from(f).ok())
 .and_then(|f| f.checked_mul(usize::from(channels)));
 let mut samples: Vec<f32> = Vec::with_capacity(expected.unwrap_or(0));
 ```

 No doubling growth and no realloc copies when the count is known.

2. **Split open from decode** so callers see the size before allocating:

 ```rust
 pub struct OpenedAudio {
 // format reader, decoder, track_id, sample_rate, channels, bit_depth_hint
 pub num_frames: Option<u64>,
 }
 pub fn open_audio(path: &Path) -> AppResult<OpenedAudio>;
 pub fn decode_all(opened: OpenedAudio) -> AppResult<DecodedAudio>;
 pub fn decode_file(path: &Path) -> AppResult<DecodedAudio> {
 decode_all(open_audio(path)?)
 }
 ```

3. **One large file at a time.** In `analyze_sample`:

 ```rust
 /// Frames × channels above which a job takes the large-file permit (~90 s stereo 44.1 kHz).
 const LARGE_JOB_SAMPLES: u64 = 8_000_000;
 static LARGE_JOB: Mutex<()> = Mutex::new(());

 let opened = open_audio(path)?;
 let big = opened
 .num_frames
 .is_none_or(|f| f.saturating_mul(u64::from(opened.channels)) > LARGE_JOB_SAMPLES);
 let _permit = big.then(|| LARGE_JOB.lock().unwrap_or_else(PoisonError::into_inner));
 let pcm = decode_all(opened)?;
 ```

 Unknown length counts as large.

4. **One mono buffer, shared.** Move `to_mono` to `audio/mod.rs` as `pub fn to_mono(pcm: &DecodedAudio) -> Vec<f32>`. In `analyze_sample`: compute `mono` once; call a new `peaks::cache_peaks_from_decoded_with_mono(peaks_dir, id, &pcm, &mono, buckets)` that uses it for colors instead of `mix_to_mono`; build `TechInfo { sample_rate, channels, duration_ms, bit_depth_hint }`; then `drop(pcm)` before heuristics. `write_technical_fields` takes `&TechInfo`.

5. **Analyze an excerpt.** Change the `Analyzer` trait input:

 ```rust
 pub struct AnalysisInput<'a> {
 /// Mono excerpt for tempo, key and loop detection. At most EXCERPT_SECS long.
 pub mono: &'a [f32],
 pub sample_rate: u32,
 /// Full file duration, for the one-shot vs loop length rule.
 pub duration_ms: f64,
 }

 pub trait Analyzer {
 fn analyze(&self, path: &Path, input: &AnalysisInput<'_>, bpm_min: f64, bpm_max: f64) -> AnalysisResult;
 }

 const EXCERPT_SECS: f64 = 60.0;

 /// Up to EXCERPT_SECS: the whole file. Longer: start at 10 % (at most 30 s in) to skip intros.
 pub fn excerpt_range(frames: usize, sample_rate: u32) -> std::ops::Range<usize>;
 ```

 `HeuristicAnalyzer` and `detect_loop_or_oneshot` use `input.mono` and `input.duration_ms` and stop calling `to_mono`. `PathTokenAnalyzer` ignores the input. Update the bench and `perf_budgets.rs` to build an `AnalysisInput` from a decoded fixture.

**Tests:**

- `excerpt_range`: 30 s file covers the whole range; 90 s file starts at 9 s and is 60 s long; 10 min file starts at 30 s and is 60 s long.
- Synthetic click track, 3 minutes at 120 BPM, 44.1 kHz, generated in the test: excerpt BPM within ±1 of 120.
- Existing heuristic tests on local example sample fixtures unchanged. All fixtures are under 60 s, so results must be identical.

**Verify:** `tool/memwatch.sh` during a wave: `Physical footprint (peak)` < 2 GB for the whole wave.

---

### Midpoint profile run

Not a decision point. The rest of Phase A goes ahead either way. Run the profile protocol once so the log shows what A1 to A5 fixed on their own. Record `fe.get_peaks` p90, `fe.fps` median during analyze with no folder open, `ipc.folder_tree` per minute, `fe.row_wave_paint` p95 and max, and `Physical footprint (peak)`.

---

### A6. Kill the library refresh storm (M)

**Why:** ~50 `folder_tree` rebuilds a minute, each followed by a full list refetch and 200 `stat` calls. Every favorite click does the same.

**Files:** `src-tauri/src/watch.rs`, `src-tauri/src/library.rs`, `src-tauri/src/samples.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/analyze/mod.rs`, `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`, `src/components/App.tsx`, `LibraryView.tsx`, `FolderSidebar.tsx`, `src/lib/ipc.ts`, new `src/lib/patchRows.ts`.

**Step 1: typed, coalesced change events (Rust).**

```rust
// watch.rs
#[derive(Debug, Clone, Default, Serialize)]
pub struct LibraryChangedPayload {
 pub reason: String,
 /// Samples added, removed, renamed or a root changed: tree and list must refetch.
 pub structural: bool,
 /// Rows whose fields changed (availability, technical, analysis). Patch in place.
 pub sample_ids: Vec<i64>,
}

/// Merges change notices and emits at most one `library-changed` per window.
#[derive(Default)]
pub struct ChangeCoalescer {
 pending: Mutex<Option<LibraryChangedPayload>>,
 scheduled: AtomicBool,
}

impl ChangeCoalescer {
 const WINDOW: Duration = Duration::from_millis(1500);

 pub fn push(self: &Arc<Self>, app: &AppHandle, reason: &str, structural: bool, ids: &[i64]) {
 {
 let mut p = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
 let cur = p.get_or_insert_with(Default::default);
 merge(cur, reason, structural, ids);
 }
 if self.scheduled.swap(true, Ordering::AcqRel) {
 return;
 }
 let me = Arc::clone(self);
 let app = app.clone();
 std::thread::spawn(move || {
 std::thread::sleep(Self::WINDOW);
 me.scheduled.store(false, Ordering::Release);
 let payload = me.pending.lock().unwrap_or_else(PoisonError::into_inner).take();
 if let Some(mut payload) = payload {
 payload.sample_ids.sort_unstable();
 payload.sample_ids.dedup();
 let _ = app.emit("library-changed", payload);
 }
 });
 }
}

/// Pure merge, unit-tested on its own.
fn merge(cur: &mut LibraryChangedPayload, reason: &str, structural: bool, ids: &[i64]) {
 cur.structural |= structural;
 cur.sample_ids.extend_from_slice(ids);
 if cur.reason.is_empty() {
 cur.reason = reason.to_owned();
 }
}
```

Put one `Arc<ChangeCoalescer>` in `AppState` and pass it into `WatchShared`. Replace every direct `emit("library-changed", ...)`:

| Source | `structural` | `sample_ids` |
| --- | --- | --- |
| watch: rename, `mark_missing`, `index_paths` > 0 | true | empty |
| watch: `refresh_technical` changed or became local | false | those ids |
| launch availability backfill (`lib.rs`) | false | `became_local_ids`, or `structural: true` if more than 2 000 |
| `respond_ask_index` | true | empty |
| analyze worker, after the DB write for one sample | false | that id |

`samples::refresh_technical` must return `sample_id` for every changed row, not only when it became local.

**Step 2: patch rows instead of refetching (frontend).**

- New Rust command `get_samples(ids: Vec<i64>) -> Vec<SampleDto>`: off main, `WHERE id IN (...)` in chunks of 500, same DTO and tag join as `list_samples`.
- `App.tsx` `library-changed` handler:
 - `structural`: refresh stats + tree + tags and bump the list token, as today.
 - otherwise: write the ids to a `rowChangesStore` (from A4's `createStore`). `LibraryView` subscribes, intersects the ids with its current rows, and if any match calls `ipc.getSamples(matching)` and patches those rows. Refresh `db_stats` at most every 10 s. The tree is not touched.
- Remove the `analysis-progress` path that calls `bump()` when `remaining === 0`. The per-sample ids already patch rows.
- Edits (`toggleFavorite`, type, BPM, key, tags, undo/redo): after the IPC resolves, patch the affected rows with `getSamples(ids)` instead of `reload()`. For favorite, flip the row first (optimistic), then reconcile with the fetched row. `reload()` stays only for root add/remove, purge missing and remove sample.
- Keep object identity for untouched rows so memoized rows skip rendering:

 ```ts
 // src/lib/patchRows.ts
 export function patchRows(rows: readonly SampleRow[], updates: readonly SampleRow[]): SampleRow[] {
 if (updates.length === 0) return rows as SampleRow[];
 const byId = new Map(updates.map((u) => [u.id, u] as const));
 let changed = false;
 const next = rows.map((r) => {
 const u = byId.get(r.id);
 if (!u) return r;
 changed = true;
 return u;
 });
 return changed ? next : (rows as SampleRow[]);
 }
 ```

**Step 3: cheaper `folder_tree`.** Done in the quick fixes; listed here for reference.

```rust
let rows: Vec<(i32, String, i64)> = samples_dsl::samples
 .filter(samples_dsl::missing.eq(0))
 .group_by((samples_dsl::root_id, samples_dsl::parent_path))
 .select((samples_dsl::root_id, samples_dsl::parent_path, diesel::dsl::count_star()))
 .load(conn)?;
```

Walk ancestors once per distinct parent (2 817 instead of 20 439) and add `n` instead of 1 to the inclusive counts. Output stays identical.

**Step 4: virtualize the sidebar folder list.** In `FolderSidebar`, use `useVirtualizer({ count: visibleFolders.length, getScrollElement: () => scrollRef.current, estimateSize: () => 23, overscan: 8 })` on the existing `.sidebar-scroll` element (`.tree-row` is 23 px in `library.css`). Render only virtual items inside a relative wrapper of `getTotalSize()` height, each with `position: absolute; transform: translateY(start)`. Keep keys as `node.path`. When `selectedPath` changes from outside (for example "show parent"), call `virtualizer.scrollToIndex(idx, { align: "auto" })`. Root collapse behavior stays as today.

**Step 5: availability check on folder open only.** In `refreshSamples`, run the cloud-path check only when `omni.folder` differs from the last checked folder (keep it in a ref).

**Tests:**

- Rust: `merge` combines three pushes into one payload with `structural = any` and all ids; the flush dedups.
- Rust: `folder_tree` existing tests unchanged; new test with two files in one folder asserts `sample_count == 2` on the folder and its ancestors.
- Rust: `get_samples` returns the right rows with tags; empty input returns empty.
- FE: `patchRows` keeps identity for untouched rows and returns the same array when nothing matched.
- FE: `FolderSidebar` with 3 000 folders renders fewer than 100 `.tree-row` elements.

**Verify:** during an analyze wave with Dropbox hydrating, `ipc.folder_tree` ≤ 1 per 10 s and `ipc.emit name=library-changed` ≤ 40 per minute. `document.querySelectorAll('*').length` under 3 000 with the Dropbox root expanded (Web Inspector console). Clicking a star produces no `ipc.list_samples` or `ipc.folder_tree`. BPM/key appear in visible rows while analyze runs, without a full list refetch.

---

### A7. Stop creating canvases while scrolling (M)

**Why:** 221 fresh-canvas paints cost 53.6 s of WebView thread time; repaints of existing canvases cost ~0.

**Files:** `src/lib/rowPeaks.ts`, `src/components/SampleTable.tsx`, `SampleRowView.tsx` (from A4), `RowWaveform.tsx`, new `src/lib/waveTheme.ts`, new `src/lib/paintQueue.ts`, `src/theme/subscribeThemePaint.ts`, `src/lib/spectralColor.ts`, `library.css`.

**Step 1: measure the 240 ms (30 min).** With A1's inspector: Timelines, record while scrolling a 700-row folder with waves on. Note whether the cost sits in Layout (forced by `clientWidth`) or in canvas/Paint (backing store). Write the answer into this doc. Steps 2 to 6 remove both causes either way; the answer only decides whether D1 is ever needed.

**Step 2: smaller window.** Done in the quick fixes (`ROW_OVERSCAN` 6).

**Step 3: stable row slots.** Key rows by slot so React keeps the same DOM row (and canvas) and feeds it a new sample. `index % N` does not work: a row entering the window gets a different remainder than the row that left, so nothing is reused. Use a slot allocator instead (`src/lib/rowSlots.ts`): an index keeps its slot while visible, and entering rows take the slots of rows that left.

```tsx
const slotsRef = useRef<SlotState>(emptySlots());
const slots = assignSlots(slotsRef.current, virtualItems.map((v) => v.index));
slotsRef.current = slots;

{virtualItems.map((v) => (
 <SampleRowView key={slots.byIndex.get(v.index) ?? v.index} /* ... */ />
))}
```

`data-index` and `data-sample-id` still update per render, so keyboard and menu code that queries them keeps working.

Changes this needs in `RowWaveform`:

- **Always render the `<canvas>`**, also while analyzing, missing, cloud or peaks not loaded. Draw the placeholder on the canvas (a 1 px line at mid height in the ink color at 35 % alpha). Show the shimmer as an absolutely positioned overlay `<span>` only when the row's `analyzing` flag is set. Today the component swaps the canvas for a `<div>`, which destroys the canvas every time.
- Reset per-row UI state when `sampleId` changes: `hoverFraction` to `null`.
- Read peaks by id with `useSyncExternalStore`, not `useState` + effect, so a reused row never paints the previous sample's wave for a frame. In this phase, make the existing `peakCache` in `rowPeaks.ts` subscribable: add `getRowPeaks(id)` and `subscribeRowPeaks(id, fn)` with the same signatures as in B1, and call the id's listeners when a fetch lands. B1 later swaps the internals and keeps these two functions.

**Step 4: no layout or style reads per paint.**

```ts
// src/lib/waveTheme.ts
import { readSpectralBandsFrom, type SpectralBandColors } from "./spectralColor";

export interface WaveTheme { ink: string; inkSelected: string; bands: SpectralBandColors }
let cached: WaveTheme | null = null;

/** One getComputedStyle per theme change, not per row. The vars live on :root. */
export function waveTheme(): WaveTheme {
 if (cached) return cached;
 const s = getComputedStyle(document.documentElement);
 cached = {
 ink: s.getPropertyValue("--color-row-wave").trim() || "#6a6d80",
 inkSelected: s.getPropertyValue("--color-row-wave-sel").trim() || "#b9b0f0",
 bands: readSpectralBandsFrom(s),
 };
 return cached;
}

export function invalidateWaveTheme(): void {
 cached = null;
}
```

- Split `readSpectralBands(el)` in `spectralColor.ts` into `readSpectralBandsFrom(styles: CSSStyleDeclaration)` and keep the old function as a wrapper for the detail pane.
- `subscribeThemePaint.ts`: call `invalidateWaveTheme()` at the start of `paintAll()`, so the theme color lerp still animates rows.
- Width: `SampleTable` observes the header cell `[data-col="wave"]` with one `ResizeObserver` and passes `waveWidth = Math.max(40, rect.width - WAVE_PAD_X)` to rows, where `WAVE_PAD_X = 16` matches `.sample-row .col.wave { padding: 0 14px 0 2px }`. `RowWaveform` sets the canvas CSS width from that prop and never reads `clientWidth`.

**Step 5: paint in one rAF pass with a budget.**

```ts
// src/lib/paintQueue.ts
const queue = new Map<HTMLCanvasElement, () => void>();
let raf = 0;
const BUDGET_MS = 6;

export function schedulePaint(canvas: HTMLCanvasElement, paint: () => void): void {
 queue.set(canvas, paint); // latest paint for a canvas wins
 if (raf === 0) raf = requestAnimationFrame(flush);
}

export function cancelPaint(canvas: HTMLCanvasElement): void {
 queue.delete(canvas);
}

function flush(): void {
 raf = 0;
 const deadline = performance.now() + BUDGET_MS;
 for (const [canvas, paint] of queue) {
 queue.delete(canvas);
 paint();
 if (performance.now() > deadline) break;
 }
 if (queue.size > 0) raf = requestAnimationFrame(flush);
}
```

`RowWaveform` calls `schedulePaint(canvas, paint)` from its effect and `cancelPaint(canvas)` in cleanup. Keep the `fe.row_wave_paint` mark inside `paint`.

**Step 6: fetch only when scrolling stops.** Run the prefetch effect only when `!virtualizer.isScrolling`, drop `PEAK_PREFETCH_PAD` to 8, and drop queued ids that are no longer in the range (clear `waitQueue` entries whose id is not in the new urgent set). The `new Map(...)` was already removed in the quick fixes. B1 later replaces this effect with `requestVisible`.

**Step 7:** moved to D1 (only if this item does not meet the bar).

**Tests:**

- `paintQueue.test.ts` (mock `requestAnimationFrame` and `performance.now`): latest paint per canvas wins; the budget spills the rest into the next frame; `cancelPaint` removes a pending paint.
- `SampleTable.test.tsx`: scrolling the virtual list by 10 rows keeps the same `<canvas>` element instances (compare identity before and after).
- `waveTheme.test.ts`: cached until `invalidateWaveTheme()`.

**Verify:** `fe.row_wave_paint` p95 < 3 ms, max < 16 ms, no 240 ms group. `fe.scroll` gap p95 < 50 ms while scrolling n ≥ 2k with waves on. Web Inspector shows no forced layout inside `paint`.

---

### Check after Phase A

Run the profile protocol. Then:

- Stop if the success bar is met.
- Go to Phase B if visible waves take > 150 ms to fill after scrolling stops, the peaks queue wait (`fe.peaks_start`) p95 > 50 ms, WebContent memory grows on a second scroll through 3k rows, or sift footprint climbs past ~400 MB while auditioning long files.
- Consider D1 if `fe.row_wave_paint` still has paints over 16 ms and A7 Step 1 blamed canvas creation.
- Consider D3 on its trigger (list IPC or list commit still slow for n ≥ 3 000).

---

## Phase B: row peaks and decode cache

Goal: row waves arrive in one small binary batch for what is on screen. Audition memory gets a byte limit.

---

### B1. Batched, binary, cancelable row peaks (M)

**Why:** one IPC per row with a ~50 KB JSON body; rows that scrolled away stay queued (wait p50 22.8 s).

**Depends on:** A3. Pairs with A7 (rows read the peak store).

**Files:** `src-tauri/src/audio/peaks.rs`, `src-tauri/src/samples.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` (register command), `src/lib/rowPeaks.ts` (rewrite), `src/lib/drawWaveform.ts`, `src/lib/spectralColor.ts`, `src/components/RowWaveform.tsx`, `SampleTable.tsx`, `LibraryView.tsx`, `src/lib/rowPeaks.test.ts` (rewrite), `src/lib/drawWaveform.bench.ts`.

**Step 1: wire format.** Little-endian. One response per batch:

```text
u32 count
repeat count:
 i32 sample_id
 u8 status 0 = ok, 1 = not ready (no peakfile yet), 2 = not local or missing
 u8 reserved
 u16 buckets 256 for rows; 0 when status != 0
 f32 duration_ms
 i8 min[buckets] mono: min over channels, scaled by 127
 i8 max[buckets] mono: max over channels, scaled by 127
 u8 rgb[buckets*3]
```

12-byte row header plus 1 280 bytes of data. A 64-row batch is ~83 KB, against ~3.2 MB of JSON today.

**Step 2: Rust.**

```rust
// peaks.rs
pub const ROW_BUCKETS: usize = 256;

/// Read the cached 1024-bucket peakfile. Never decodes.
pub fn read_cached_peaks(peaks_dir: &Path, sample_id: i64) -> AppResult<Option<PeakData>> {
 read_peakfile(&peak_path(peaks_dir, sample_id), Some(DEFAULT_BUCKETS))
}

/// Append one encoded row (status 0). Downsample by grouping
/// `DEFAULT_BUCKETS / ROW_BUCKETS` source buckets per output bucket:
/// min of mins and max of maxes across the group and all channels, then
/// quantize with a helper `quantize_i8(v) = round(clamp(v, -1, 1) * 127)`.
/// Colors: average each RGB channel across the group.
pub fn encode_row(out: &mut Vec<u8>, sample_id: i32, data: &PeakData);

/// Append a header-only row with `status` 1 or 2 and `buckets = 0`.
pub fn encode_status(out: &mut Vec<u8>, sample_id: i32, status: u8);
```

```rust
// commands/mod.rs
#[tauri::command]
pub async fn get_row_peaks(app: AppHandle, ids: Vec<i64>) -> AppResult<tauri::ipc::Response> {
 off_main(app.clone(), move |state| {
 // One `WHERE id IN (...)` query: (id, missing, availability).
 let rows = state.db.with_conn(|conn| samples::row_targets(conn, &ids))?;
 let mut out = Vec::with_capacity(ids.len().saturating_mul(1_300).saturating_add(4));
 out.extend_from_slice(&u32::try_from(rows.len()).unwrap_or(0).to_le_bytes());
 let mut not_ready = Vec::new();
 for (id, missing, availability) in rows {
 if missing || availability != "local" {
 peaks::encode_status(&mut out, id, 2);
 continue;
 }
 match peaks::read_cached_peaks(&state.paths.peaks_dir, id_to_i64(id))? {
 Some(data) => peaks::encode_row(&mut out, id, &data),
 None => {
 peaks::encode_status(&mut out, id, 1);
 not_ready.push(id_to_i64(id));
 }
 }
 }
 if !not_ready.is_empty() {
 crate::analyze::enqueue_ids(app, state.db.clone(), state.paths.peaks_dir.clone(), not_ready);
 }
 Ok(tauri::ipc::Response::new(out))
 })
 .await
}
```

The row path never decodes. A missing peakfile queues analyze; the row gets its wave when that sample's A6 change event arrives (the store refetches ids that were "not ready"). `get_peaks` stays as-is for the detail pane. Add `get_row_peaks` to `generate_handler!`.

**Step 3: frontend peak store and queue (rewrite `rowPeaks.ts`).**

```ts
import { invoke } from "@tauri-apps/api/core";

export interface RowPeaks {
 durationMs: number;
 buckets: number;
 mins: Int8Array;
 maxs: Int8Array;
 colors: Uint8Array;
}
export type RowPeaksEntry = RowPeaks | "not-ready" | "unavailable";

const MAX_ENTRIES = 3000; // ~4 MB
const BATCH = 64;
const cache = new Map<number, RowPeaksEntry>(); // insertion order = LRU order
const listeners = new Map<number, Set<() => void>>();
let wanted: number[] = [];
let inflight = false;

export function getRowPeaks(id: number): RowPeaksEntry | undefined {
 return cache.get(id); // no reordering here: getSnapshot must be pure
}

export function subscribeRowPeaks(id: number, fn: () => void): () => void {
 let set = listeners.get(id);
 if (!set) listeners.set(id, (set = new Set()));
 set.add(fn);
 return () => {
 set.delete(fn);
 if (set.size === 0) listeners.delete(id);
 };
}

/** Replace the wanted list with what is on screen. Ids no longer visible are dropped. */
export function requestVisible(ids: readonly number[]): void {
 wanted = [];
 for (const id of ids) {
 const hit = cache.get(id);
 if (hit === undefined || hit === "not-ready") wanted.push(id);
 else touch(id, hit); // keep visible rows at the fresh end of the LRU
 }
 void pump();
}

/** Called with A6 change ids: refetch those that had no peakfile yet. */
export function invalidateRowPeaks(ids: readonly number[]): void {
 for (const id of ids) if (cache.get(id) === "not-ready") cache.delete(id);
}

async function pump(): Promise<void> {
 if (inflight || wanted.length === 0) return;
 const batch = wanted.splice(0, BATCH);
 inflight = true;
 try {
 const buf = await invoke<ArrayBuffer>("get_row_peaks", { ids: batch });
 for (const [id, entry] of decodeRowPeaks(buf)) setEntry(id, entry);
 } catch {
 /* leave ids uncached; the next requestVisible retries */
 } finally {
 inflight = false;
 void pump();
 }
}
```

- `decodeRowPeaks(buf)` reads headers with one `DataView` and makes `new Int8Array(buf, offset, n)` / `new Uint8Array(buf, offset, n)` views for the data, with no copies.
- `touch(id, entry)` does `cache.delete(id); cache.set(id, entry)`. `setEntry` does the same, evicts the oldest while `cache.size > MAX_ENTRIES`, and calls that id's listeners.
- A `"not-ready"` entry that `requestVisible` asks for again goes back into `wanted`, which is fine: it costs one header in the next batch.
- Profile marks: `fe.peaks_batch` (ms, n, bytes) and `fe.peaks_wanted` (count).

**Step 4: who calls it.** In `SampleTable`:

```ts
const isScrolling = virtualizer.isScrolling;
useEffect(() => {
 if (!showWaveforms || isScrolling) return;
 const ids: number[] = [];
 const from = Math.max(0, rangeStart - 8);
 const to = Math.min(samples.length - 1, rangeEnd + 8);
 for (let i = from; i <= to; i++) {
 const s = samples[i];
 if (s && !s.missing && s.availability === "local") ids.push(s.id);
 }
 requestVisible(ids);
}, [showWaveforms, isScrolling, samples, rangeStart, rangeEnd]);
```

While scrolling nothing is fetched. 150 ms after scrolling stops, one batch covers the view. `App.tsx` passes A6 change ids to `invalidateRowPeaks` before the rows patch, so the next `requestVisible` refetches them.

**Step 5: drawing.** Add `paintRowWave(ctx, peaks: RowPeaks, opts)` in `drawWaveform.ts`: the same gradient envelope as `paintGradientEnvelope`, reading `mins[i] / 127` and `maxs[i] / 127`. Change `bucketWeights(colors: ArrayLike<number>, i)` and the `WaveLanePeaks` array fields to `ArrayLike<number>` so both paths share helpers. `RowWaveform` reads its entry with `useSyncExternalStore((fn) => subscribeRowPeaks(sampleId, fn), () => getRowPeaks(sampleId))`. Add a 256-bucket case to `drawWaveform.bench.ts`.

`LibraryView.onScrubRow` reads duration from `sample.duration_ms`, falling back to `getRowPeaks(id)` when that entry is a `RowPeaks`. Remove `cachedRowPeaks`.

**Tests (rewrite `rowPeaks.test.ts`, mock `invoke`):**

- Only one `invoke` in flight; a `requestVisible` during a fetch replaces `wanted`, and the old ids are never fetched.
- `decodeRowPeaks` round-trips a buffer built in the test with one ok, one not-ready and one unavailable row.
- LRU evicts the oldest entry at `MAX_ENTRIES + 1`; `requestVisible` on a cached id moves it to the fresh end.
- `invalidateRowPeaks` clears only `not-ready` entries.
- Rust: `encode_row` on a hand-built 2-channel, 1024-bucket `PeakData` gives the expected header, `max >= min` everywhere, ±1.0 quantized to ±127, and averaged colors.

**Verify:** `fe.peaks_batch` p95 < 30 ms for 64 rows. Visible waves filled within 150 ms after scrolling stops. JS heap (Web Inspector, Memory) stays flat when scrolling a 3 000-row folder twice.

---

### B2. Decode cache by bytes (S)

**File:** `src-tauri/src/audio/decode_cache.rs`.

- Replace `capacity` (entries) with `budget_bytes` (default 256 MB) and track `used_bytes` (sample count × 4). Evict from the front of `order` until the new entry fits. An entry larger than the whole budget is returned but not cached.

**Tests:** convert `lru_evicts_oldest` to a byte budget; add "entry larger than budget is not retained".

**Verify:** audition 20 long files in a row; footprint stays under ~400 MB.

---

### Check after Phase B

- Stop if the success bar is met.
- Go to Phase C if `fe.fps` median while scrolling during an analyze wave is < 50, `ipc.list_samples` p95 during analyze is more than 2× its idle value, or Instruments shows analyze threads on performance cores while you scroll.

---

## Phase C: background work tuning

Goal: analyze does not compete with the UI for CPU priority or the database.

---

### C1. Analyze scheduling: QoS and focus-aware workers (S)

**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/analyze/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs` (index threads).

1. **QoS.** Add `qos-threads = "0.1"`. Read its source first: it is small and new. The unsafe FFI must stay in a dependency because the crate forbids `unsafe_code`. At the top of each analyze worker, and in the index and availability background threads:

 ```rust
 let _ = qos_threads::set_current_thread(qos_threads::Qos::Low); // macOS: QOS_CLASS_UTILITY
 ```

 Spawn with names (`std::thread::Builder::new().name(format!("sift-analyze-{i}"))`) so Instruments shows them.

2. **Fewer workers while focused.**

 ```rust
 pub struct WorkerGate { allowed: Mutex<usize>, cv: Condvar }

 impl WorkerGate {
 pub fn set_allowed(&self, n: usize) {
 *self.allowed.lock().unwrap_or_else(PoisonError::into_inner) = n;
 self.cv.notify_all();
 }
 /// Block worker `index` while index >= allowed.
 pub fn wait_turn(&self, index: usize) {
 let mut allowed = self.allowed.lock().unwrap_or_else(PoisonError::into_inner);
 while index >= *allowed {
 allowed = self.cv.wait(allowed).unwrap_or_else(PoisonError::into_inner);
 }
 }
 }
 ```

 Workers call `gate.wait_turn(i)` before taking the next job. In `lib.rs`, add `.on_window_event(|window, event| if let WindowEvent::Focused(f) = event { gate.set_allowed(if *f { 2 } else { 4 }) })`.

**Test:** with `allowed = 2`, worker index 3 blocks until `set_allowed(4)` (spawn a thread, check it has not progressed after 50 ms, then release).

**Verify:** Instruments, CPU: analyze threads run on efficiency cores while you scroll. A full wave with the window unfocused finishes within 10 % of today's wall time.

---

### C2. SQLite: split reads from writes, batch writes (M)

**Files:** `src-tauri/src/db/mod.rs`, `src-tauri/src/db/models.rs`, read call sites in `commands/mod.rs` and `library.rs`, `src-tauri/src/analyze/mod.rs`.

1. **Read connection.**

 ```rust
 pub struct Db {
 conn: Mutex<SqliteConnection>, // writer: migrations and all writes
 read: Mutex<SqliteConnection>, // UI reads only
 }
 // open_inner: after migrations, open a second connection to the same file with
 // PRAGMA foreign_keys = ON; PRAGMA query_only = ON; PRAGMA busy_timeout = 2000;
 // and add PRAGMA busy_timeout = 5000 to the writer.
 pub fn with_read<T>(&self, f: impl FnOnce(&mut SqliteConnection) -> AppResult<T>) -> AppResult<T>;
 ```

 Move to `with_read`: `list_samples`, `get_samples`, `row_targets`, the `get_sample` lookups in `get_peaks` / `play_sample` / `prefetch_decode`, `folder_tree`, `db_stats`, `list_tags`, `list_roots`, `get_settings`. Everything else stays on `with_conn`.

2. **One UPDATE per analyzed sample.** Replace the separate `diesel::update` calls in `analyze_sample` (technical fields plus up to 6 more) with one changeset, in one transaction with the tag inserts:

 ```rust
 #[derive(AsChangeset, Default)]
 #[diesel(table_name = samples)]
 pub struct AnalysisUpdate {
 pub sample_rate: Option<i32>,
 pub channels: Option<i32>,
 pub duration_ms: Option<f64>,
 pub format: Option<String>,
 pub bit_depth: Option<i32>,
 pub bpm: Option<f64>,
 pub bpm_confidence: Option<f64>,
 pub key_name: Option<String>,
 pub key_confidence: Option<f64>,
 pub sample_type: Option<String>,
 pub analyzed_at: Option<String>,
 pub updated_at: Option<String>,
 }
 ```

 Diesel skips `None` fields in an `AsChangeset`, which matches today's "write only when detected" rules.

**Tests:** existing analyze tests pass; add a test that a `with_read` query succeeds while another thread holds an open write transaction on the writer.

**Verify:** `ipc.list_samples` p95 is the same with and without an analyze wave running.

---

### Check after Phase C

- Stop if the success bar is met.
- Otherwise check the Phase D triggers. If none apply, re-profile with Instruments and Web Inspector and add a new finding to this doc before writing more code.

---

## Phase D: last resorts, each on its own trigger

Each item here is larger or riskier. Do one only when its trigger fires.

---

### D1. One canvas for the wave column (M)

**Trigger:** after Phase A, `fe.row_wave_paint` still shows paints over 16 ms, and A7 Step 1 showed canvas creation (not layout) as the cost.

An absolutely positioned canvas over the wave column inside `.sample-table-body`, sized to the viewport, redrawn in one rAF for the visible range on scroll, resize or peak arrival. Rows keep an empty `.col.wave` cell for hover, scrub and playhead overlays. 

---

### D2. Streaming analyze (L)

**Trigger:** after Phase A, `Physical footprint (peak)` is still over 1 GB during a wave. Expect this to come from the few files over 5 minutes.

After A5, the 38-minute file still holds ~800 MB interleaved plus ~400 MB mono under the permit. Streaming removes full-file buffers from the analyze path.

**Files:** new `src-tauri/src/audio/stream_analyze.rs`, `src-tauri/Cargo.toml`, `src-tauri/src/analyze/mod.rs`, `src-tauri/src/audio/peaks.rs`, `docs/reference/tech-stack.md`.

1. **moodbar streaming API.** Open a PR on [gildesmarais/moodbar.rs](https://github.com/gildesmarais/moodbar.rs) that exports the existing internals:

 ```rust
 pub struct MoodbarStream { inner: FrameAnalyzer }
 impl MoodbarStream {
 pub fn new(sample_rate: u32, options: &GenerateOptions, total_samples_hint: Option<usize>) -> Self;
 pub fn feed(&mut self, mono: &[f32]);
 pub fn finish(self) -> MoodbarAnalysis;
 }
 ```

 Until it is released, point at a fork: `[patch.crates-io] moodbar-analysis = { git = "https://github.com/<your-fork>/moodbar.rs", rev = "<sha>" }`, and note it in `docs/reference/tech-stack.md`.

2. **Stream in one pass** when `num_frames` is known. Fall back to A5's path when it is not.

 ```rust
 pub struct StreamResult {
 pub peaks: PeakData, // 1024 buckets per channel, same as today
 pub excerpt: Vec<f32>, // mono, excerpt_range() only
 pub tech: TechInfo,
 }

 pub fn analyze_stream(opened: OpenedAudio, buckets: usize) -> AppResult<StreamResult> {
 // frames known: bucket for frame f = f * buckets / frames (checked math)
 // per packet:
 // copy interleaved into packet_scratch (reused Vec)
 // for each frame: update per-channel min/max for its bucket,
 // mono = mean of channels, push into mono_scratch (reused, packet-sized),
 // if the frame is inside the excerpt range: push mono into `excerpt`
 // moodbar.feed(&mono_scratch); mono_scratch.clear()
 // finish: colors = resample_colors(moodbar.finish().colors(), buckets)
 }
 ```

 Moodbar options must match `generate_spectral_colors` today (`adaptive_fft_size(frames)`, `GlobalPeak`, cuts at 200 Hz and 6 kHz, `max_target_frames = buckets`) so peakfiles look the same. No peakfile version bump.

3. `analyze_sample` uses `analyze_stream` for every file with known `num_frames`. The large-file permit stays for the fallback path only.

**Tests:**

- For every local example sample fixture: streaming min/max equal `generate_peaks(decode_file(..))` exactly; colors differ by at most 2 per channel.
- The excerpt equals `to_mono(decoded)[excerpt_range(..)]` exactly.
- Criterion: `analyze_stream` is no slower than decode + generate on the longest fixture.

**Verify:** footprint peak < 1 GB for a full wave including the 38-minute file; < 300 MB 60 s after `analyze.queue_done`.

---

### D3. Windowed list API (L)

**Trigger:** after Phase A, `fe.list_ipc − ipc.list_samples` p90 is still > 100 ms, or `fe.list_commit` p90 > 50 ms, for folders with n ≥ 3 000. Otherwise skip.

**Shape:** keep the full ordered id list in the frontend (it is small) and fetch full rows only for what is on screen.

- `list_sample_ids(query) -> tauri::ipc::Response` with packed `i32` ids in sort order (12 KB for 3 000 rows).
- `get_samples(ids)` from A6 fills a row LRU (`Map<number, SampleRow>`, cap 2 000) exposed like the B1 peak store.
- In `LibraryView`, `samples: SampleRow[]` becomes `ids: Int32Array` plus a `useRow(id)` hook. The table requests rows for the visible range ± 50, the same way B1 requests peaks.
- Selection, shift-range, arrow keys and play-next switch from `samples.findIndex` to a `Map<id, index>` built once per list.
- `selectedSamples` (drag, copy path, tag picker, byte count) becomes `await ipc.getSamples([...selectedIds])` when the selection includes rows not in the cache.

---

## Success bar

**How to run:** `bun run tauri:profile` and `tool/memwatch.sh` in a second terminal. To force an analyze wave on local files, before launching:

```bash
sqlite3 "$HOME/Library/Application Support/dev.jfk.Sift/library.sqlite3" "UPDATE samples SET analyzed_at = NULL WHERE availability = 'local';"
```

```bash
find "$HOME/Library/Caches/dev.jfk.Sift/peaks" -name '*.peaks' -delete
```

User-set BPM, key and type survive. Normal analyze only fills empty fields. Let Dropbox keep syncing. Then: 2 minutes with no folder open, 3 minutes scrolling a 2k+ folder with waves on, 1 minute auditioning with arrow keys, then idle until `analyze.queue_done` plus 60 s.

| Scenario | Metric | Target | Item |
| --- | --- | --- | --- |
| Analyze wave, no folder open | `fe.fps` median; `fe.frame` ≥ 100 ms per minute | ≥ 55; 0 | A3, A4, A6 |
| Analyze wave, scroll n ≥ 2k, waves on | `fe.scroll` gap p95 | < 50 ms | A7 |
| Same | `fe.row_wave_paint` p95 / max | < 3 ms / < 16 ms | A7 |
| Same | Visible waves filled after scroll stops | < 150 ms | B1 |
| Same | `fe.peaks_batch` p95 (64 rows) | < 30 ms | B1 |
| Any | `fe.get_peaks` p90 (detail pane) | < 30 ms | A3 |
| Analyze wave | `ipc.folder_tree` | ≤ 6 per minute | A6 |
| Analyze wave | `library-changed` emits | ≤ 40 per minute | A6 |
| Analyze wave | Main-thread samples in `sift_lib` (Instruments) | < 5 % | A3 |
| Playback | React commits per animation frame | 0 | A4 |
| Arrow-key audition | The row you stop on is the one playing | always | A3 |
| Star / BPM / tag edit | Triggers `ipc.list_samples` or `ipc.folder_tree` | never | A6 |
| Memory, analyze wave | sift `Physical footprint (peak)` | < 1 GB | A5, D2 |
| Memory, 60 s after wave | sift `Physical footprint` | < 300 MB | A5, B2 |
| Memory, WebContent process | after scrolling 3k rows twice | < 500 MB, flat on the second pass | B1 |
| Audition | `ipc.play_sample` warm p95 | < 60 ms | A3, B2 |
| Throughput | Full wave wall time, window unfocused | within 10 % of before | C1 |

---

## Decisions taken

Open questions, with defaults so work can start. Change them here if you disagree.

- Analysis excerpt: 60 s, starting at 10 % of the file (at most 30 s in) for files over 60 s. Affects 183 of 20 439 files. If a long-file BPM turns out wrong, add a "full file" option to Custom analysis.
- Sidebar: virtualize the full expanded tree (A6 Step 4). Behavior stays as today.
- Row buckets: 256, mono (min/max over channels). The detail pane keeps 1024 per channel.
- Workers: 2 while the window is focused, 4 when not. QoS utility always.
- moodbar: upstream PR plus a pinned git fork until released. If the maintainer declines, vendor the crate under `src-tauri/vendor/moodbar-analysis` with the one added type.
