# Large collection profiling notes

Working notes from dogfooding Sift against a ~50 GB Dropbox sample library
(`…/Producing/samples/`). Goal: turn this into action items so first-time users
with big libraries get a usable app during index + analyze.

Last updated: 2026-09-22 18:05 (CET)

Shipped under plan `large_library_ux` (metadata-first browse, bytes gated).
Action items below are the checklist. The plan file is the sequencing source.

---

## Profile marks (large-collection)

Useful when re-running `bun run tauri:profile` after Dropbox is local:

| Mark | Meaning |
| --- | --- |
| `ipc.add_root` | Sync command wall time (includes watch register) |
| `watch.register` | Recursive FSEvents registration for all roots |
| `index.batch` | Every 25 audio files scanned (walk + SQLite) |
| `index.root_done` | Full `index_root` for one root |
| `ipc.folder_tree` | Sidebar tree rebuild |
| `analyze.queue_start` / `queue_done` | Bulk analyze job size + total wall |
| `analyze.batch` | Cumulative wall every 25 analyzed |
| `analyze.sample` | Per-file total (every sample) |
| `analyze.stat` / `decode` / `heuristic` / `db_write` | Breakdown every 25th sample. `decode` includes Dropbox hydration + Symphonia |

Existing play/peaks marks still apply for interactive paths.

---

## Scenario

| Item | Value |
| --- | --- |
| Root | Dropbox File Provider path under `Library/CloudStorage/…/samples` |
| Approx size | ~50 to 57 GB logical; ~24.5 GB on disk (see Disk inventory) |
| After index | **20 439** samples, **2** roots (also `example_samples`) |
| UI cap | `list_samples` `limit=5000` → status "5,000 of 20 439 shown" |
| Session | `bun run tauri:profile` (release + `SIFT_PROFILE=1`) |
| Log | `logs/sift-profile.log` |
| DB | `~/Library/Application Support/dev.jfk.Sift/library.sqlite3` |

---

## Timeline (2026-09-22)

| Time | What |
| --- | --- |
| ~15:54:59 | Profile process start |
| ~15:57:40 | Still snappy on `example_samples` (play/reuse/buffer_swap healthy) |
| ~15:57:50 | Large root selected / indexing begins |
| **15:57:50 → 16:00:34** | **~164 s hard beachball** (no profile marks) |
| 16:00:34 | First post-freeze mark: `ipc.list_samples` `n=5000` in **660 ms** |
| 16:00:34 | Matching `fe.list_samples` **112 423 ms** (~112 s). FE waited the whole freeze |
| 16:00+ | UI intermittently paints; scroll lag multi-second |
| 16:01 | Screenshot: analyzing ~46/20 382; every visible row "Analyzing…" |
| 16:03 | Still ~100% CPU, RSS ~3.2 GB (earlier peak ~6.9 GB); analyzed ~190 |

Freeze length (user-facing): about **2.5 to 3 minutes** before usable frames; scroll
still multi-second delayed after that.

---

## What's healthy (already fixed / OK at small scale)

From earlier `example_samples` profile runs:

- Decode LRU + same-file seek reuse (`play.reuse` ~0 ms)
- Persistent cpal stream + `play.buffer_swap` (~0 ms after first cold open)
- Peaks cache hits ~2 ms when warm
- Search / small `list_samples` fine

Those wins do **not** help the large-root onboarding path.

---

## Disk inventory (2026-09-22 17:33)

Walk of `…/Producing/samples` (Python / `st_blocks` + `UF_DATALESS`):

| | Count | Size |
| --- | ---: | ---: |
| All files | 23 108 | logical **57.3 GB**, allocated **24.5 GB** |
| Audio | 20 382 |. |
| Local (not dataless) | ~5.9 k | **~24.4 GB** allocated |
| Dropbox dataless stubs | ~14.4 k | **0** allocated, ~31 GB logical |
| True 0-byte files | 0 | stubs report full remote `st_size` |

DaisyDisk **26,2 GB** ≈ real disk (`du` ~25 G). It is **not** "fully downloaded."

**Startup behavior (important for dogfood):** launch only `watch::restart`. **no**
auto-reindex / `enqueue_unanalyzed`. Hydrated-in-place files that are already in
the DB only get watch `refresh_technical`, not Normal analyze. Trigger
**Reindex** (or analyze) explicitly to queue work.

**Analyze queue:** single thread, `id ASC`, no dataless skip/timeout. One cloud
stub early in the queue blocks decode (`read()` hydration) while thousands of
local files wait behind it; DB mutex held across that decode starves peaks/play.

---

## Diagnosis (ranked)

### 0. Cold start: `folder_tree` walks the Dropbox FS (new, 17:35)

Before any analyze, two sync `ipc.folder_tree depth=6` calls took **21.7 s +
21.6 s** (~43 s). `watch.register` was only 382 ms. Implementation recursively
`fs::read_dir`s under each root (see `library::folder_tree` / `walk_dirs`).

Effects observed this session:

- Blank window + beachball for ~first minute
- Process later idle (~0% CPU) while UI still looked dead, then recovered
- No `analyze.*` / `index.*` marks. This hang is **pure tree walk + FE peaks**

### 0b. Folder click beachball: blocking decode on dataless files (17:40)

`Amen Breaks` list IPC was fine (80 rows, ~50 ms). Beachball after selection
with Waveforms ON. Folder on disk: **72/80 dataless**. Profile log went silent
after `fe.list_samples`.

App has **no** `convertFileSrc` / asset-protocol waveform path. Row waves are
`get_peaks` → `decode_file`. `sample` still showed AppKit main thread stuck in
`read()` under WebKit URL-scheme plumbing (Tauri IPC / WebView), i.e. **interactive
path blocked on Dropbox hydration** while decoding stubs. Same class as analyze
hydration, but freezes input entirely.

**Session end:** user Ctrl+C'd `tauri:profile` after Amen Breaks hang (~17:47).

### 1. Auto-analyze entire library immediately after index

`add_root` → background `index_root` → `enqueue_unanalyzed` → analyze **all**
rows with `analyzed_at IS NULL` (~20k).

Effects:

- Sustained ~100% CPU (Symphonia decode + heuristics per file)
- Multi‑GB RSS (peak ~6.9 GB observed)
- Contends with peaks / list IPC (see below)
- Spec copy says "browse and play while this runs". Currently false for large libs

### 2. Analysis FE event flood

Per sample:

- `analysis-queue` emits the **full** `Vec` of unanalyzed ids once (~20k numbers)
- `analysis-progress` emits **every** completed id

FE keeps `analyzingIds: Set` of the entire queue → every visible row shows
"Analyzing…", and each progress event triggers React state updates.

Likely a major contributor to jank even when paints resume.

**16:06 note:** Beachball *while hovering* with CPU only ~7% points at the
**WebView/JS main thread**, not continuous Rust compute. Cyclic ~few-second
freezes line up with profile gaps of 3 to 6 s and slow `get_peaks` completions.
With **Waveforms ON**, scroll/viewport changes enqueue many peak fetches that
return in bursts and force layout work on top of analysis-driven re-renders.

### 3. First `list_samples` after index is catastrophic

Evidence:

```
ipc.list_samples  660ms   n=5000
fe.list_samples   112423ms  limit=5000
```

IPC itself was under a second; the FE call spanned the whole beachball. That
implies the UI thread / bridge was blocked or starved until the payload could
be applied (serialize 5k full rows + React commit + competing work), not that
SQL alone took two minutes.

Still: shipping **5 000 full `SampleDto`s** (paths, tags, …) on every refresh
is heavy for first paint after a huge index.

### 4. Scroll lag = peaks IPC queueing, not peak DSP

At 16:03, last ~200 profile events while scrolling / waveforms:

| Mark | n | avg | max |
| --- | --- | --- | --- |
| `fe.get_peaks` | 34 | **2582 ms** | **6493 ms** |
| `ipc.get_peaks` | 34 | **1715 ms** | **5858 ms** |
| `peaks.decode` | 32 | 2 ms | 8 ms |
| `peaks.generate` | 33 | 4 ms | 16 ms |
| `peaks.write` | 33 | 8 ms | 13 ms |
| `peaks.cache_miss` (inner) | 33 | 14 ms | 30 ms |

Inner peak work is fine. **Seconds** are spent waiting before/around the
command (analysis holding DB / runtime, Dropbox hydration, or IPC backlog).
Virtualized scroll fires many `get_peaks` → each waits → scroll feels dead.

### 5. Recursive FSEvents watch on huge Dropbox tree

`add_root` calls `restart_watches` **synchronously** before returning, with
`RecursiveMode::Recursive` over the whole root. On a File Provider / Dropbox
tree this can be slow and memory-heavy (watch registration). Suspect for early
freeze + RAM spike; not fully isolated from index/analyze yet.

### 6. Dropbox File Provider I/O

Paths under `Library/CloudStorage/…`. First touch of many files can block on
hydration. Fits "decode 2 ms but IPC 2 s" less than queueing does, but still a
risk for cold peaks/analyze on cloud-only files.

---

## User-visible symptoms (expected with current code)

1. Add large root → beachball for minutes.
2. Then: library appears, status "Analyzing N of M", most rows "Analyzing…".
3. Scroll / click delayed by seconds.
4. Waveforms often flat until peaks eventually return.
5. "browse and play while this runs" is misleading.

---

## Recommendations

### Multithreading / concurrency (yes, but not first)

**Current state:** almost no parallel audio work.

| Path | Threads today |
| --- | --- |
| Index (`index_root`) | One background thread; sequential `WalkDir` + SQLite |
| Analyze (`spawn_analysis_batch`) | **One** background thread; `for sample_id in ids { analyze… }` |
| Peaks / play IPC | Sync Tauri commands; share the process with that one analyzer |
| Watcher | Separate notify / FSEvents threads (OK) |
| cpal | Audio callback thread (OK) |

So: the heavy import path is **single-threaded analyze**. Index is also single-threaded (usually fine; disk-bound).

**Should we multithread analyze?** Yes, as a **P1 throughput** win for 20k+ libraries. **after** UI isolation, not instead of it.

Why not first:

1. Tonight's beachball happened with CPU often **idle (~7%)**. more workers won't fix WebView jank from event floods / huge list commits.
2. N parallel decodes without caps → RAM spike (we already saw ~7 GB peak) and worse DB/IPC contention → **worse** scroll/play.
3. Progress events × N workers without throttling → more FE storms.

**Recommended shape (when we do it):**

1. **Worker pool, small N**. start with `num_cpus.min(4)` or a fixed `2`-`4`, configurable later.
2. **Decode off the DB lock**. open/decode/analyze in the worker; only hold SQLite for the short metadata write. Today `analyze_sample` likely holds `with_conn` across decode (verify when implementing); that alone serializes everything and starves `get_peaks`.
3. **Priority lane for interactive IPC**. play / get_peaks / list must not wait behind a full analyze queue (dedicated pool or "interactive first").
4. **Throttle FE events regardless of worker count**. `{ done, total }` on an interval; never emit 20k ids.
5. **Optional later:** parallel peak generation for visible rows (bounded), still cancelled when scrolled away.

**Do not** parallelize the initial recursive FSEvents `watch()` registration; move it off the command thread (already in action items) and keep watch setup single-shot.

### Goal: metadata-first UI (browse is not bytes)

Index already learns the file tree from `stat` (path / size / mtime) without
reading audio bytes. Dropbox dataless stubs still expose that metadata.
Analyze / peaks / play need real bytes and can block on hydration.

**Product rule:** the folder tree and sample list come from indexed DB rows and
stay responsive even when bytes are not local yet. Analyze, waveforms, play,
and any file `read()` are a separate pipeline that must not stall browsing.

Sample readiness (distinct from Missing):

| State | Meaning | UI |
| --- | --- | --- |
| Indexed | Path known in DB | Show in tree + list |
| Ready / local | Bytes on disk (`!dataless`, `st_blocks > 0`) | Play, peaks, analyze OK |
| Pending / cloud | Exists remotely; not hydrated | Badge "Online only" / "Not downloaded"; **not** Missing; play/peaks disabled or off the UI thread |
| Missing | Removed / gone from disk | Existing missing treatment |

Multithreading still helps finish analyze faster once bytes are allowed. It
does not replace this split. Without it, one dataless `read()` on the main
thread (Amen Breaks) beachballs the whole app after the list already returned.

### Order of attack (recommendation)

1. **P0 metadata-first shell**. DB-backed tree + list; browse without touching bytes; Ready / Pending / Missing states.  
2. **P0 cold start**. kill FS `folder_tree` walk; don't block `add_root` on watch restart.  
3. **P0 UI isolation**. throttle analyze events; no giant `analyzingIds`; cheaper first list.  
4. **P0 never `read()` on the UI thread**. skip dataless for peaks/play/asset protocol; offload or placeholder.  
5. **P1 capped analyze worker pool** + prefer Ready / skip Pending. Throughput after the UI is safe.  
6. **P1/P2** watcher / Dropbox onboarding copy.

Multithreading is the right lever for "20k files take forever." It is the **wrong** first lever for "beachball while analyzing," "blank window on launch," or "folder click freezes."

---

## Action items (draft. Prioritize for new-user UX)

Ordered by impact / feasibility. Refine after more samples in this doc.

### P0. Metadata-first browse (disconnect UI from bytes)

0. **Browse from index only.** Sidebar folders + sample rows come from SQLite
   (paths already indexed). Never require decode, peaks, or file `read()` to
   show that a sample exists.
1. **Expose readiness separately from Missing.** Persist or compute
   Ready / Pending(cloud) / Missing (see Goal table above). Pending must not
   look like deleted. Play / analyze / waveforms only when Ready (or after an
   explicit user-triggered hydrate that runs off the UI thread).
2. **Gate the bytes pipeline.** Auto-analyze and row-waveform prefetch skip
   Pending files; optional background hydrate queue that never blocks list,
   tree, or AppKit main thread.

### P0. Keep UI alive during bulk analyze

3. **Do not send 20k ids in `analysis-queue`.** Send `{ total }` only (or a
   small window). Row "Analyzing…" only for the active id / small batch.
4. **Throttle `analysis-progress`** (e.g. Every 25 to 100 files or 250 ms), not
   per file.
5. **Cap concurrent analyze / yield**: analyze in chunks; pause or deprioritize
   when user is scrolling / playing (or always leave headroom for IPC).
6. **Defer `enqueue_unanalyzed`** until idle, or require explicit "Analyze
   library", or analyze visible **Ready** folder first.

### P0. First paint / cold start (large Dropbox root)

7. **`folder_tree` must not sync-walk the cloud FS on every load.** Build the
   sidebar from **DB paths** (distinct parent folders of indexed samples), or
   cache the tree, or lazy-expand one level at a time. Two × ~22 s `read_dir`
   over File Provider paths is enough alone to blank the window. This is the
   concrete implementation of metadata-first for the sidebar.
8. **Don't block `add_root` on `restart_watches`.** Start watch on a background
   thread; return root immediately.
9. **Cheaper initial list**: lower default limit, folder-scoped list by
   default, or progressive load; avoid serializing 5k full DTOs for first
   paint. Prefer opening a subfolder, not "all roots / 5 000 of 20 k".
10. **Debounce `library-changed` / index-done `bump()`** so FE doesn't refresh
    tree + 5k rows + tags in one frame under load.

### P1. Analyze throughput (after UI isolation)

- **Capped worker pool** for analyze (2 to 4 threads): decode/CPU in parallel;
  short DB writes only. See [Recommendations](#recommendations).
- Ensure `analyze_sample` does **not** hold the SQLite mutex across Symphonia
  decode (unblock peaks/play).
- Interactive IPC priority so workers can't starve `get_peaks` / `play_sample`.
- Queue **Ready files first**; skip or defer Pending/dataless.

### P1. Scroll / waveforms under load

11. **Peaks request priority / concurrency limit** so analyze can't starve
    `get_peaks` (separate pool or don't hold DB across decode). Even with
    analyze idle, viewport floods still produce `fe.get_peaks` **p90 ~870 ms**
    while Rust `ipc.get_peaks` stays ~10 ms (IPC/JS backlog).
12. **Cancel / coalesce** out-of-view peak fetches (FE already prefetches;
    ensure abort when scrolled away).
13. **Stable row chrome while peaks load**. virtualizer already paints row
    shells; empty table body while scrolling (17:39 screenshot: 2 rows then
    void, "5,000 of 20 439 shown", Waveforms ON) means name/type cells are
    lagging the scroll position or not painting until peaks settle. Keep text
    columns visible immediately; waveform column can stay a cheap placeholder.
14. **Never block the UI/main thread on file `read()`** for row media / custom
    protocols. Amen Breaks (17:40): list returned, then beachball with main
    thread in `startURLSchemeTask` → `read()` on dataless Dropbox files.
    Offload scheme I/O, skip `UF_DATALESS` / Pending, or disable row waveforms
    until peaks come from a background cache only.

### P1. Watcher / Dropbox / analyze queue

15. Revisit recursive watch on huge trees (depth limit, lazy watch on expanded
    folders, or watch only after index settles).
16. Document Dropbox / File Provider caveats; prefer local copies for perf.
    First full analyze of an online-only tree **downloads the corpus** via
    hydration. Expected, and should be disclosed in onboarding.
17. **Skip or defer dataless files** in analyze (`UF_DATALESS` / `st_blocks==0`):
    don't block the single worker on hydration when thousands of local files
    are already ready. Same rule as Pending in the metadata-first table.

### P2. Product copy / onboarding

18. Status text: prefer "Library browsable; analyzing local files…" once
    metadata-first lands (until then: warn UI may be slow on first large import).
19. First-launch: warn before importing tens of thousands of files; offer
    "index only" vs "index + analyze".
20. Clarify that app restart does **not** resume analyze / reindex. User must
    reindex or trigger analyze after finishing offline download.
21. Explain Online only / Not downloaded vs Missing in UI copy.

### P2. Telemetry / profiling gaps

22. Profile marks for: `add_root` / `restart_watches`, `index_root` batches,
    `analysis` decode vs write, `folder_tree`, FE apply of list payload.
    **Landed (2026-09-22):** `ipc.add_root`, `watch.register`, `index.batch`,
    `index.root_done`, `ipc.folder_tree`, `analyze.queue_*`, `analyze.batch`,
    `analyze.sample`, and every-25th `analyze.stat|decode|heuristic|db_write`.
    Still missing: FE-side list apply timing (optional); optional readiness
    counts.
23. Log analysis queue size and event rate when `SIFT_PROFILE=1`.
    **Partially landed:** `analyze.queue_start n=…`.

---

## Live progress log

Append snapshots while dogfooding. Do not delete older rows.

### 2026-09-22 16:03

- Process: `target/release/sift` pid 6110, etime ~8m, **CPU ~100%**, RSS ~3.2 GB
- DB: 20 439 samples; analyzed **190**; unanalyzed **20 249**
- Profile: peaks path starved. `fe.get_peaks` avg ~2.6 s / max ~6.5 s while
  inner decode/generate ~ms
- User report: scroll responds only after multiple seconds
- Rough ETA at ~190 / ~6 min of analyze ≈ 30/min → **~11+ hours** for full
  20k if rate stays flat (order-of-magnitude only)

### 2026-09-22 16:06

- User: **beachball on hover**, then after ~10 s UI refreshes but stays barely
  responsive (cyclic freeze / thaw). Waveforms toggle ON. Detail pane can show
  a real waveform for the selected file; table cells still mostly "Analyzing…".
- Status bar (screenshot): Analyzing **188 of 20 382** (DB a bit ahead: analyzed
  **274** by 16:06:21. FE progress events lag / throttle visually).
- Process: etime ~11m, **CPU ~7%** (no longer pegged. Likely I/O wait /
  Dropbox), RSS ~**600 MB** (down from 3 GB+).
- Profile last 60 s: **151** events; `fe.get_peaks` avg **3.5 s** / max **7.7 s**;
  inner peaks still ~ms. Regular **3 to 6 s gaps** between profile marks. Matches
  multi-second input delay / beachball pulses.
- Interpretation: even with CPU idle-ish, the UI thread is still jammed by
  (a) per-file `analysis-progress` → React re-render of table with huge
  `analyzingIds` Set, (b) waveform prefetch `get_peaks` backlog returning in
  bursts, (c) possibly Dropbox latency. Beachball-on-hover = AppKit seeing the
  WebView main thread stuck in JS/layout, not only "Rust busy".

### 2026-09-22 16:08 (auto tick)

- Process: etime ~13m, **CPU ~5%**, RSS ~**225 MB** (cooling further)
- DB: analyzed **344** / 20 439 (~1.7%); ~**26/min** since 16:06 → still
  ~**13 h** remaining at this rate if linear
- Profile last 3 min: `fe.get_peaks` n=72 avg **3.7 s** / max **7.8 s** : 
  scroll/waveform path still starved; no improvement from lower CPU alone
- Loop will keep appending until process exits or analysis completes

### 2026-09-22 16:10 (auto tick)

- Process: etime ~16m, **CPU ~0.2%**, RSS ~250 MB
- DB: analyzed **536** / 20 439 (~2.6%); +192 since 16:08 (~64/min burst) : 
  rate uneven (Dropbox / mix of file sizes)
### 2026-09-22 16:12

- User: **UI responsive again** (no beachball while idle / light use).
- Bottleneck check (`sample` on analyzer thread): **~89% of samples in
  `read()`** (kernel), not Symphonia/math. Analyze is **I/O-bound** on the
  Dropbox File Provider path, one file at a time.
- Throughput probe: **+2 analyzed / 3 s** (~40/min) while process CPU ~2 to 5%.
  Idle CPU is expected: the worker blocks on cloud/local hydration reads.
- Secondary structural issue (still true): `db.with_conn(|| analyze_sample…)`
  holds the SQLite mutex for the whole decode+write, so interactive
  `get_peaks` queues behind each slow `read()` when the UI is busy. When the
  user isn't scrolling waveforms, that lock barely shows up → UI feels fine.
- Implication: multithreading helps **only if** workers overlap Dropbox waits
  (and UI isolation is in place). More CPU cores alone won't help while each
  worker sits in `read()`.

### 2026-09-22 16:12 (Dropbox UI)

- User screenshot: Dropbox desktop **actively syncing** ("Synchroniseren…",
  ~2.9 MB / ~10 s). Matches on-demand **Smart Sync / File Provider hydration**:
  Sift opens a path → Dropbox pulls the blob → our `read()` unblocks.
- So the analyze "idle CPU" is largely **waiting on Dropbox to materialize
  each file**, not a stuck mutex with no work. Parallel workers could issue
  multiple hydrations at once (faster wall clock, more Dropbox traffic / RAM).
- Product note for large cloud libraries: prefer "index metadata only first",
  analyze after local, or warn that first analyze will download the library.

### 2026-09-22 16:13 (offline pin check)

- User believed folder was **Make available offline**. Probe of **80 unanalyzed**
  paths via `ls -lO`: **77 dataless**, **3** fully present. Recently touched /
  just-analyzed files show `dataless=False` + real sizes. Hydration on read.
- So offline pin did **not** fully land on this tree (still in progress, partial
  apply, or File Provider eviction). Dropbox UI syncing ~MB is Sift forcing
  those dataless stubs materialize one-by-one.

### 2026-09-22 16:13 (session pause)

- User quit profile run to finish Dropbox offline download first. Auto monitor
  stopped. Re-probe still **~97/100 dataless** among unanalyzed. Pin has a
  long way to go. Re-dogfood after Dropbox shows the folder fully offline /
  `dataless` count collapses.

### 2026-09-22 16:16

- Confirm: no Sift / no monitor loop. Analyzed frozen at **659**. Offline probe
  still ~**97/100 dataless**.

### 2026-09-22 17:33 (disk inventory)

- ~**24.5 GB** actually on disk; ~**14.4 k** audio still dataless (~31 GB logical).
- DaisyDisk 26,2 GB ≈ allocated size, not full library.

### 2026-09-22 17:35 to 17:39 (profile restart, partial local)

- `bun run tauri:profile` with existing roots; **no** reindex/analyze this run.
- Immediate blank window + beachball.
- Profile smoking gun:
  - `watch.register` **382 ms**
  - `ipc.folder_tree` **21 694 ms** then again **21 611 ms**
  - `ipc.list_samples` **19 ms** / `fe.list_samples` **582 ms** (`n=5000`)
  - Then peaks flood: `ipc.get_peaks` p50 **~9 ms**, `fe.get_peaks` p50 **19 ms**
    but p90 **~870 ms** / max **912 ms** (155 fetches)
- Process later **0% CPU**, RSS ~264 MB, log stopped. Hung UI with nothing to do
  on the Rust side.
- After recovery: scroll "a bit more responsive" but **empty list body for a
  while** while scrolling (screenshot: 2 name rows, then void; Waveforms ON;
  "5,000 of 20 439 shown"). Matches peaks/JS backlog outrunning the virtualizer.
- Folder click `Amen Breaks`: `list_samples` n=80 Rust **50 ms**, FE **301 ms**.
- Recs reinforced: **P0 = DB/lazy folder_tree**; P1 = scroll peaks coalesce +
  stable row text; skip dataless in analyze when that path is re-dogfooded.

### 2026-09-22 17:40 (Amen Breaks beachball)

- User clicked sidebar **Amen Breaks** (80 files). UI greyed / beachball.
- Profile: list already finished (`ipc.list_samples` 50 ms, `fe.list_samples`
  301 ms). **No further profile marks** for ~70 s+ while stuck.
- Disk: Amen Breaks is **72 dataless / 8 local** (~55 MB logical stubs).
- `sample` on main thread: **100% samples in `read()`** under WebKit
  URL-scheme / IPC plumbing. Waveforms are `get_peaks`→`decode_file` (no
  `convertFileSrc` in app). Beachball = interactive path blocked on Dropbox
  hydration, not slow list SQL.
- notify-rs debouncer thread also stuck on mutex (secondary).
- Rec: never decode cloud/dataless on the UI/IPC path; skip Pending for
  row waveforms.

### 2026-09-22 17:47 (session end)

- User stopped `bun run tauri:profile` with Ctrl+C after Amen Breaks hang.
- Terminal confirms cold-start marks: `watch.register` 382 ms,
  `ipc.folder_tree` 21694 ms + 21611 ms, then peaks flood / Amen list.

### 2026-09-22 ~18:00 (metadata-first in tree)

Plan `large_library_ux` is implemented. Re-check with profile:

| Before (17:35) | Expect now |
| --- | --- |
| `ipc.folder_tree` ~21.7 s × 2 (FS walk) | under 100 ms (DB `parent_path` tree) |
| Launch lists 5 000 rows | Empty state until you pick a folder |
| Amen Breaks + Waveforms ON beachballs | Placeholders for `cloud`; peaks only for local |
| Analyze queue includes dataless | Local-only pool (2 to 4 workers), decode off DB lock |

```bash
bun run tauri:profile
# cold open → folder_tree marks; click Amen Breaks with Waveforms ON;
# confirm no beachball; status shows local-only analyze.
```

---

## How to refresh this doc

```bash
# DB
sqlite3 "$HOME/Library/Application Support/dev.jfk.Sift/library.sqlite3" \
  "SELECT COUNT(*), SUM(analyzed_at IS NOT NULL), SUM(analyzed_at IS NULL) FROM samples;"

# Process
pgrep -lf 'target/release/sift'
ps -p <pid> -o etime,%cpu,rss

# Profile tail / gap hunter (see agent session or logs/sift-profile.log):
#   logs/sift-profile.log
```

When adding a snapshot: time, analyzed counts, CPU/RSS, worst recent
`fe.get_peaks` / `fe.list_samples`, and one line of user-visible behavior.
