# Sift v1 — master plan index

**Status:** planning complete; implementation in progress  
**SoT:** [SPEC.md](../../SPEC.md) (behavior) → [docs/design/](../design/) (chrome) → [docs/TECH_STACK.md](../TECH_STACK.md) (stack)  
**Rules:** [RULES.md](RULES.md) — read at the start of every phase

## Goal

Ship a buildable, runnable Tauri 2 + React Sift v1 on macOS that covers SPEC Musts and the Claude Design surfaces, dogfoodable against [example_samples/](../../example_samples/).

## Progress

| Phase | Doc | Status |
|-------|-----|--------|
| 01 Scaffold | [phases/01-scaffold.md](phases/01-scaffold.md) | complete |
| 02 Shell, theme, i18n | [phases/02-shell-theme-i18n.md](phases/02-shell-theme-i18n.md) | complete |
| 03 DB + settings | [phases/03-db-settings.md](phases/03-db-settings.md) | complete |
| 04 Library roots + first launch | [phases/04-library-roots.md](phases/04-library-roots.md) | complete |
| 05 Indexer | [phases/05-indexer.md](phases/05-indexer.md) | complete |
| 06 Sample table | complete | in_progress |
| 07 Decode + peaks | complete | pending |
| 08 Playback | complete | pending |
| 09 Waveforms + selection | complete | pending |
| 10 JIT + drag | in_progress | pending |
| 11 Tags | [phases/11-tags.md](phases/11-tags.md) | complete |
| 12 Omni search | [phases/12-omni-search.md](phases/12-omni-search.md) | complete |
| 13 Analysis | [phases/13-analysis.md](phases/13-analysis.md) | pending |
| 14 Watch + polish | [phases/14-watch-polish.md](phases/14-watch-polish.md) | pending |

## Architecture sketch

```text
React WebView (chrome, chips, table, canvas draw, dialogs)
        │  Tauri commands + low-rate events
        ▼
Rust core: SQLite index · notify watch · symphonia decode · cpal play
           peak workers · Analyzer trait · hound JIT · tauri-plugin-drag
```

## Out of v1 (do not implement)

Collections, saved searches, light mode, query language, Web Audio preview, Electron, metadata write-back to audio files, full shortcut editor, Linux, store/accounts, MIDI mode, preview stretch/FX.

## Workflow

1. Start phase → set status `in_progress` here and in the phase doc.
2. Implement until acceptance criteria pass.
3. Set status `complete`, commit, push `main`.
4. Next phase. Repeat through 14.
