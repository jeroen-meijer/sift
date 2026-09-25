# Sift tech stack

Working recommendation for implementing [spec.md](../spec.md). Not a locked ADR until a spike confirms the three risks below. Last updated: 2026-09-22.

Related: [loudline](https://github.com/jeroen-meijer/loudline) (same author) is Tauri 2 + React with audio in the WebView. Sift reuses that shell. Audio stays in Rust.

---

## Recommendation

**Tauri 2 + React + TypeScript + Vite + Bun for the UI. Heavy work runs in Rust.**

| Layer | Choice | Role |
|-------|--------|------|
| Desktop shell | Tauri 2 | Window, IPC, permissions, installers (macOS + Windows) |
| UI | React 19 + TypeScript + Vite | Dense chrome matching Claude Design mockups (chips, table, dialogs) |
| Tooling | Bun | Same as loudline: install, scripts, `tauri:dev` / `tauri:build` |
| Audio I/O | Rust `cpal` | Preview playback to a chosen output device |
| Decode | Rust `symphonia` | WAV, AIFF, FLAC, MP3, AAC/M4A, OGG, Opus |
| Metadata / index | SQLite via Diesel | App DB only; never write tags into source audio in v1 |
| FS watch | Rust `notify` | Recursive watch per library root; debounce in Rust |
| JIT clips | Rust WAV writer (e.g. `hound`) | Exact rate / bit depth / channels; files in app cache |
| Drag → DAW | `tauri-plugin-drag` (`startDrag`) | Drag real paths (full files or JIT clip files already on disk) |
| Waveform peaks | Rust peakfile / downsample workers | UI draws Canvas (or WebGL) from buffers Rust already built |
| BPM / key / type | Rust worker pool | Algorithms still Open in SPEC; keep behind a trait |

Do **not** use Electron. Do **not** use Web Audio / AudioWorklet as the primary preview or analysis engine.

---

## Hard boundary

Rust owns everything that must stay fast or durable under a large library:

- Open → decode → play (select→play latency)
- Analysis queue and progress events
- Continuous filesystem watch and cheap mtime/size checks
- Library index and metadata overrides
- JIT clip render into the cache directory
- Peakfile generation for row and detail waveforms

The WebView owns layout and interaction chrome:

- Omni search + chips, folder/tag sidebars, sample table virtualization
- Detail waveform *drawing* and pointer interaction (playhead, selection, snap UI)
- Settings, dialogs, context menus
- Status bar copy

IPC is Tauri commands plus low-rate events (playhead position, analysis progress, index diffs). Do not stream PCM through JSON. Do not put the audio callback on the UI thread.

Loudline runs metering and preview in the WebView, which fits one-file loudness work. Sift needs fast select→play, large libraries, and background analysis, so decode/play/analysis stay in Rust.

---

## Why Tauri (and why not only Rust UI)

Claude Design mockups are dense VS Code-like chrome (chip bar, virtualized table, dual-pane waveform, purple-dark theme). React matches that shape quickly. Loudline already ships Tauri 2 + React 19 + Vite + Bun, so packaging and habits transfer.

SPEC needs native-speed audio, analysis, and I/O in the same process. The WebView is UI only.

Common setup: Tauri for UI and `cpal` (or similar) in Rust for the device graph. Real-time rules still apply: no alloc/lock in the audio callback; lock-free queues between UI and audio.

`tauri-plugin-drag` / `drag-rs` can start a native drag of file paths to Finder/Explorer and into DAWs. Sift is path-based (full file or JIT WAV on disk), which matches that API. Spike it early on both OSes; network/SMB paths have had Windows bugs in drag-rs.

---

## Why not the alternatives (for now)

| Option | Verdict for Sift v1 |
|--------|---------------------|
| Electron | Heavier; fights the SPEC wording. No win over Tauri for this shape. |
| Web Audio preview (loudline-style) | Fine for one file. Weak for device picker fidelity, RT priority, racing Up/Down select→play, and large-library decode policy. |
| egui / eframe (pure Rust UI) | Strong for waveforms and native drag-out (see [audiofiles](https://maxj.phd/git/max/audiofiles)). Weaker for matching the Claude Design mockups and for React reuse from loudline. Keep as the fallback if Tauri fails the spike. |
| Iced | Retained-mode Rust UI; smaller ecosystem and slower UI iteration for this density. |
| Dual native (SwiftUI + WinUI) | Best OS chrome; doubles UI work. Only if shared Rust core is extracted later and product needs force it. |

Fallback plan: keep the Rust core crates (`audio`, `index`, `analyze`, `watch`) UI-agnostic. If drag-out or scrubbing feels wrong under Tauri, swap the shell to egui without rewriting the engine.

---

## Suggested crate / package sketch

Exact versions pinned at scaffold time. Rechecked 2026-09-22: the set below is still the default choice for Sift. Notes call out where the ecosystem moved or where a spike may swap one crate.

### Rust (src-tauri or a workspace of crates)

| Concern | Primary pick | Notes (2026) |
|---------|--------------|--------------|
| Shell / IPC | `tauri` 2.x, `tauri-plugin-dialog`, `tauri-plugin-fs` (scoped), `tauri-plugin-drag` | Still correct. Loudline already on Tauri 2. |
| Output devices + RT stream | **`cpal`** | Still the low-level standard (CoreAudio / WASAPI). Prefer over `rodio` for Sift: device picker, buffer control, and select→play need the stream API, not a high-level player. `rodio` sits on `cpal` + Symphonia and is fine for simple play-a-file apps, not ideal as the engine. |
| Decode | **`symphonia` 0.6.x** | Still the pure-Rust decode default. Enable format features for SPEC codecs. **Opus:** no solid native decoder yet; use `symphonia-adapter-libopus` (bundles libopus) until first-party lands. **HE-AAC:** native incomplete; `symphonia-adapter-fdk-aac` if those files matter. AAC-LC / M4A via `aac` + `isomp4` is in good shape. |
| Index DB | **Diesel** (SQLite) + `diesel_migrations` + bundled `libsqlite3-sys` | Sync ORM with CLI migrations and typed schema. Prefer over hand-written `rusqlite` SQL. Sync fits worker/`Mutex` access; SeaORM is the async alternative if the core goes fully async later. |
| FS watch | **`notify`** + **`notify-debouncer-full`** (or similar debouncer) | Still the cross-platform watch stack. Debounce in Rust before applying Ask/Auto-index. |
| JIT WAV write | **`hound`** | Still fine for 8/16/24/32-bit PCM and float WAV write (exact rate/bit depth/channels). No strong successor; keep unless a spike finds a gap (e.g. exotic WAVEFORMATEXTENSIBLE edge cases). |
| IPC DTOs | `serde` / `serde_json` | Unchanged. |
| Async workers | `tokio` | For watch/index/analysis tasks. Audio callback stays sync on the `cpal` thread. |
| UI ↔ audio queues | **`rtrb`** (SPSC realtime) and/or `crossbeam` | Still the usual pair. Prefer `rtrb` (or equivalent wait-free ring) on the audio path; `crossbeam` channels for non-RT worker messaging. |
| BPM / key / type | Behind `trait Analyzer` | Do **not** hard-lock yet. Candidates: pure-Rust **`stratum-dsp`** (BPM + key, DJ-oriented, no FFI; evaluate on one-shots/loops, not only full tracks), **`aubio`** Rust bindings (tempo/onset/pitch; C dep; no key), or a later subprocess. Loop vs one-shot may stay heuristic/custom. |

### Frontend

- React 19 + TypeScript + Vite (loudline-aligned)
- Virtualized table (e.g. TanStack Virtual) for large result sets
- Canvas (or WebGL) waveform views driven by peak buffers from Rust
- Bun for scripts
- i18n: `i18next` + `react-i18next`. Playbook: [localization.md](localization.md). Strings only in `src/locales/<lang>/…` JSON. Components use keys (`t("…")`), never user-facing literals.
- Theming: CSS variables (or a small token module) owned by `src/themes/<name>.css` (or equivalent). Components reference `var(--…)` / token names only. v1 ships one dark theme file; new themes are new files + a registry entry.

### What not to swap casually

- Do not replace `cpal` with Web Audio for preview.
- Do not replace Symphonia with a grab-bag of per-format crates unless Symphonia fails a format you must support.
- Do not put analysis FFI on the audio callback thread.

---

## Locales and themes (editability)

Product rules: [spec.md](../spec.md) §4.13-4.14. Layout goal: a non-author can add a language or tweak colors without opening React components.

Suggested tree (names flexible; keep the split):

```text
src/
  locales/
    en/
      common.json
      library.json
      settings.json
      …
    # de/ … later
  themes/
    dark-default.css    # :root { --bg: …; --accent: …; }
    # light.css later
  i18n/
    index.ts            # init + locale list
  theme/
    index.ts            # register themes; apply data-theme / class on <html>
```

Rules:

1. No hex colors or user-visible English in `.tsx` except tests/Storybook fixtures.
2. Rust error strings that surface in the UI get a stable error code; the UI maps code → locale string.
3. Tag taxonomy defaults may ship as data (JSON/YAML), not as translated UI chrome; product copy for dialogs still goes through locales.
4. Waveform/canvas draws read theme tokens (CSS variables or a JS token object synced from the same theme file) so a theme change recolors peaks without code edits.

---

## Mapping to SPEC risks

| SPEC need | Stack approach |
|-----------|----------------|
| Near-instant select→play | Prefetch/decode in Rust; play command is tiny; no Web Audio round-trip |
| Analysis never blocks UI | Worker pool + progress events; UI stays interactive |
| Continuous watch | `notify` in Rust; Ask/Auto-index policy in app logic |
| List drag = full files; selection drag = JIT | Write JIT to cache first, then `startDrag` with that path; list multi-drag = existing paths |
| App DB only metadata | SQLite; no tag write-back to files in v1 |
| Output device + Default | `cpal` device list; persist choice in settings |
| Dark dense UI | One theme file (`themes/dark-default`); CSS variables; mockups are the visual target |
| Locales | `locales/en/…` + i18next; add a language by adding files |

---

## Implementation bias

- Prefer maintained crates and React packages when the use case fits (decode, devices, watch, DB, virtualization, i18n, BPM/key). Write glue and product UI; do not reimplement mature DSP or OS integration.
- Auto-tags v1: filename/path token → [default-taxonomy.md](default-taxonomy.md). BPM/key via crate (`stratum-dsp` first spike); unknown/low-confidence OK.
- Claude Design exports (Project HTML zip + screens) are the visual target. SPEC wins when behavior conflicts.
- v1 bar: Must surfaces that work for day-to-day use; imperfect analysis, search, and watch edges are fine until later tuning.
- App icon / logo: [`assets/brand/`](../../assets/brand/README.md); generated platform files in `src-tauri/icons/`.
- Delivery: build until the Must surfaces run end to end; tune after day-to-day use.

## Spike before locking (1-2 days)

Default assumption: spikes pass. Still run the three checks below on this Mac before calling audio/drag done:

1. **Select→play:** Row select → Rust `cpal`; feel instant under Up/Down.
2. **Row waveforms:** Scroll thousands of peakfile rows without main-thread stalls.
3. **Drag → DAW:** Local WAV (and JIT path) into a DAW installed on this machine.

Windows: validate before calling Windows support done; macOS-first is fine for the first day-to-day build.

Pass → continue. Fail on (3) or scrubbing feel → evaluate egui shell with the same Rust core.

---

## Loudline: reuse vs discard

### Reuse

- Tauri 2 project layout, version sync scripts, installer CI habits
- React + Vite + Bun toolchain
- Desktop open-file / drop-onto-window patterns (as *input* to the library, not as the analysis engine)

### Discard for Sift

- `OfflineAudioContext` / `AudioContext` decode and preview as the engine
- `loudness-worklet` (different product; LUFS is not a Sift v1 feature)
- "Thin Rust lib" assumption - Sift's `src-tauri` will hold real domain crates

Optional later: shared private crate for "decode this path to interleaved f32" if both apps want one decoder. Do not couple the products early.

---

## Open engineering choices (not blocking stack choice)

- Peakfile on-disk format and eviction
- Analysis library for BPM / key / loop-vs-one-shot (SPEC Open)
- Whether UI is one Tauri window with React router panes or multiple webviews (default: one window)
- Exact virtualization and Canvas vs WebGL for detail waveform
- Windows SMB/UNC drag-out edge cases (known drag-rs pain; prefer local paths in v1 tests)

---

## Doc history

| Date | Notes |
|------|-------|
| 2026-09-22 | Initial recommendation after SPEC v0.3, Claude Design mockups, loudline review, and public Tauri/audio research |
| 2026-09-22 | Locale + theme file layout (SPEC Q70) |
| 2026-09-22 | Crate currency pass: keep cpal/symphonia/rusqlite/notify/hound; Opus via libopus adapter; analysis still behind trait (`stratum-dsp` candidate) |
| 2026-09-22 | Implementation bias, taxonomy link, macOS-first dogfood (Q72-Q75) |
| 2026-09-22 | Index DB: Diesel + embedded migrations (replace rusqlite hand SQL) |
| 2026-09-22 | Tooling: namtao clippy/nextest/bacon; ESLint strictTypeChecked + Vitest |
| 2026-09-22 | Perf: Criterion `audio_hotpath` benches + soft `perf_*` budget tests; Vitest bench |
