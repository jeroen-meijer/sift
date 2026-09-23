# Large collection profiling V2

Post-`large_library_ux` dogfood against the Dropbox sample library.

Prior session: [LARGE_COLLECTION_PROFILING_V1.md](LARGE_COLLECTION_PROFILING_V1.md).

The "Build next" plan below is replaced by [LARGE_COLLECTION_PROFILING_V3.md](LARGE_COLLECTION_PROFILING_V3.md).

| Item | Value |
| --- | --- |
| Session | `bun run tauri:profile` (~18:47 to 19:00 CET) |
| Log | `logs/sift-profile.log` (76 678 lines, ~3.9 MB) |
| Ended | User quit app ~19:00 |
| Earlier dogfood | ~18:08 to 18:25; see [Archive](#archive-first-dogfood-1813) |

---

## Shipped since first dogfood (do not re-diagnose)

These are in the tree. Assume they work; look for regressions or leftover gaps.

### Availability

- Column `availability` + metadata classify (`fs_ready`: `stat` / `UF_DATALESS` / `st_blocks`, no open).
- Index / watch / technical refresh write the column.
- FE refreshes ≤200 cloud/unknown paths from the current list.
- Launch backfill: `refresh_availability_all` then analyze enqueue. Mark: `avail.library_refresh`.
- Hydrate then analyze: watch / availability IPC flip to `local`, then `enqueue_ids`.

### Analyze + status bar

- Analysis writes row **peakfiles** from the same decode.
- Launch resumes locals missing metadata and/or `.peaks`.
- **Single shared queue**, 4 workers, one bottom-right bar. Marks: `analyze.queue_start` / `analyze.queue_done`.
- Empty bar = analyze queue idle. May return when Dropbox hydrates more files.

### FE profile marks

| Mark | Meaning |
| --- | --- |
| `fe.frame` / `fe.fps` | rAF hitch ≥25 ms / ~1 Hz FPS |
| `fe.scroll` / `fe.virt_range` | scroll / virtualizer lag |
| `fe.list_apply` | list to setSamples |
| `fe.peaks_*` | FE peaks queue |
| `fe.row_wave_paint` | row canvas paint |
| `avail.library_refresh` | full-library availability backfill |

---

## Session outcomes (~18:47 to 19:00)

| Metric | Value |
| --- | --- |
| Availability backfill | **155 ms**, 1731 became local |
| Main analyze wave | start n=12609 to done **n=13770** |
| Tiny hydrate waves after | many `queue_start` n=1/2 (42 extra start/done pairs) |
| DB at quit | local **13991** · cloud **6448** · analyzed **13986** |
| Peakfiles on disk | **13986** |
| `analyze.sample` | 13821 |
| `peaks.cache_miss` (mostly analyze writes) | 13733 |
| `peaks.decode` while browsing | **0** |
| `ipc.folder_tree` | **550** (~65 ms) |
| `fe.frame` ≥25 ms | **6470** (777 ≥500 ms) |
| Scroll `q_wait` | often **150 to 500+** (`MAX_INFLIGHT=2`) |
| RSS | **~2.8 GB to ~12 GB** during analyze; stayed multi-GB |

Scroll (waves ON, folders up to n=3348): `ipc.get_peaks` ~2 ms; FE wait/paint seconds; FPS 1 to 12 while busy, ~60 idle. Wave shimmer with empty bottom bar = FE peaks queue, not Rust analyze.

---

## UI performance direction

### Already fine (stop chasing)

- Cold `folder_tree` ~65 ms; metadata-first browse; Online only gating.
- Launch backfill + hydrate enqueue; single analyze queue + status bar.
- Rust peakfile IO (~2 ms hits). Browse path is not re-decoding audio (`peaks.decode` = 0 while scrolling).

### Root causes of lag

1. **FE peaks queue flood (primary scroll/waves issue).** `ROW_OVERSCAN=40` + warm prefetch + no cancel. Two IPC in flight leaves `q_wait` in the hundreds, then shimmer and main-thread stalls. Rust is not the bottleneck.
2. **Huge list payloads.** `limit=5000`; `fe.list_apply` can hit hundreds of ms to seconds for n≈3k. Virtualizer limits DOM nodes, not React state / commit cost.
3. **Background work punches the UI.** Hundreds of `folder_tree`/list refreshes during analyze/hydrate; progress + `library-changed` keep the main thread busy.
4. **RSS climbs to ~12 GB** after mass decode; does not return to a lean baseline. Decode LRU is only 16; FE `peakCache` is unbounded (~1k entries seen). Suspect native allocator retention after ~14k full-file decodes + WebView heap. Hurts resize/scroll globally.
5. **UX:** row shimmer means "peaks not painted," not "in analyze queue." Bottom bar idle is correct when meta + peakfiles exist.

### Build next (priority)

**P0: memory (hard limit)**

0. **Cap process RAM.** Mass analyze drove RSS to ~12 GB; that must not happen. Target: stay in the low hundreds of MB when idle, and never multi-GB during analyze. Bound FE `peakCache`, drop PCM after each analyze job, shrink worker concurrency and/or decode scratch, verify with Instruments/`ps` after a full wave.

**P0: list feel**

1. Pause peaks enqueue while scrolling; resume ~100 to 150 ms after scroll idle.
2. Drop wait-queue jobs for rows that left the viewport (ignore late results).
3. Shrink overscan/prefetch (`ROW_OVERSCAN` ~8; warm pad ~4; urgent = visible only).
4. Cap list page size (~200 to 500), not 5000.
5. Defer/cheapen row canvas paint (rAF/idle, placeholder first, cap paints per frame).

**P0: memory (details)**

6. Bound FE `peakCache` (LRU); clear on folder change.
7. After analyze wave: ensure PCM scratch is dropped; measure RSS at idle; trim if needed.
8. Keep full PCM only in the small play LRU.

**P1: background vs UI**

9. Coalesce analyze progress FE updates; do not refetch `folder_tree` every tick.
10. Optional: fewer analyze workers while the user is interacting.
11. Different chrome for "loading peaks" vs "analyzing metadata."

**P2**

12. Periodic cloud to local recheck while open.
13. Launch backfill only stale/`cloud`/`unknown` when libraries are huge.
14. `watch.register` ~1 s cold cost.

### Next dogfood success bar

- Waves ON, n≥2k: `q_wait` ≈ viewport (≲50), not hundreds.
- `fe.virt_range` mostly &lt;100 ms; scroll FPS ≳30.
- Folder open `fe.list_apply` not multi-second.
- RSS after full analyze settles to low hundreds of MB when idle.
- Empty analyze bar + honest wave loading state (no fake "analyzing").

### Confidence (profile evidence)

Each P0 maps to a measured cause:

| Symptom | Evidence | Fix that should work |
| --- | --- | --- |
| Slow scroll / shimmer waves | `ipc.get_peaks` ~2 ms vs FE wait seconds; `q_wait` 150 to 500+ | Cancel + pause peaks; cut overscan (industry default overscan is ~1 to 5, we use **40**) |
| Lag opening big folders | `fe.list_apply` hundreds of ms to seconds for n≈3k with `limit=5000` | Page/window from SQLite; virtualization alone does not shrink React state |
| Lag during analyze | 550× `folder_tree`; FPS 1 to 12 then ~60 when idle | Stop UI refresh storms; lower analyze concurrency while interacting |
| 10 GB+ RSS | Climbed during ~14k full-file decodes; stayed high when idle | Bound caches; drop PCM per job; fewer simultaneous decodes; check allocator retention |

Apps that feel fine at tens of thousands of samples (Wave Silo, Scanalyzer-style browsers, DAW browsers) use the same shape we already started: **index in SQLite, analyze in background, store peak sidecars, virtualize the list, only paint viewport waveforms**. They keep a small hot React slice and prefetch only a few canvases ahead of scroll.

**Likely impact if P0 lands:** scroll + wave paint should become usable (that path is proven by the profile numbers). Memory should drop a lot once decode concurrency/caches are bounded; if RSS still sticks after frees, that is allocator retention (common after bursty allocate/free), fixable with fewer arenas / purge settings / isolating analyze allocations. Remaining risk is WebView + React commit cost on wide rows; that is why list paging and cheaper paints are in the same P0 bucket.

### Additions from external practice (gaps vs earlier list)

15. **Windowed SQL / infinite scroll**, not a one-time smaller `limit`: TanStack docs stress virtualization ≠ holding the full dataset in the client.
16. **Batch `get_peaks` for the visible range** (one IPC, many ids) to cut bridge overhead vs 2-at-a-time singles.
17. **Analyze concurrency 1 to 2 while the window is focused** (4 full-file decodes × large WAVs = multi-GB working set even with perfect frees).
18. **Memoize row cells**; avoid re-rendering the whole table on analyze progress.
19. On macOS after a mass analyze: confirm whether RSS is a real leak or allocator high-water; if high-water, force reclaim / isolate analyze allocs (same class of fix as jemalloc `background_thread` purge on Linux).

---

## Archive: first dogfood (~18:13)

Cold browse fixed (`folder_tree` ~64 ms). Interactive feel not fixed.

| Mark | n | p50 / max | Notes |
| --- | --- | --- | --- |
| `ipc.folder_tree` | 3 | 63 ms | Fixed |
| `ipc.list_samples` | 4 | 9 to 21 ms | Includes n=5000 |
| `ipc.get_peaks` | 85 | 2.4 ms | Cache hits |
| `fe.get_peaks` | 85 | 739 ms / 1316 ms | FE queue lag |

DB then: mostly `unknown` (before backfill). Waves-off still popped blank rows on 5000-result lists.
