# Phase 14: Watch + polish (v1 complete)

**Status:** complete

## Previous

Phase 13: analysis pipeline works; no continuous watch; gaps in menus/settings/undo.

## This phase

Close remaining SPEC Musts: continuous watch, missing files, ask/auto-index, full context menu, metadata undo/redo, hold-hover hotkey, settings completeness, dogfood pass.

### In scope

- `notify` + debouncer recursive watch per root
- New/delete/rename/modify via mtime+size (+inode); no content hashing
- Missing: keep row, show missing UI, no preview/drag; purge / remove missing (design dialogs)
- New-file mode: Auto-index (default) ± notify; Ask with Index/Skip and Index all/Skip all
- Modify → refresh technical info only; keep creative overrides
- Context menu: Open, favorite, tags, type, BPM, key, show parent folder, Reveal, copy path/filename, re-analyze, custom analysis
- Metadata undo/redo (bounded)
- Hold-to-hover-preview rebindable shortcut (default unbound)
- Settings panes: Playback, Library, Analysis, Shortcuts (design)
- Status bar: roots, indexed, analysis/index progress
- Dogfood: add a local sample folder, browse, play, search, tag, drag clip, confirm no freezes
- README: run instructions for v1

### Out of scope

- Anything listed out of v1 in SPEC / index plan
- Windows certification (macOS dogfood enough)

## Acceptance

- `bun run tauri:dev` yields a usable v1 matching SPEC Must coverage + design surfaces
- Watch picks up a copied file into a root (auto-index)
- Missing file flow works when path deleted outside app
- Context menu and settings cover SPEC lists
- All phases 01-14 marked complete in index

## Shipped vs deferred

**Landed:** recursive watch + debounce; auto/ask index; missing mark/purge/remove; modify → technical-only refresh; rename path update; context menu (Open, Favorite, Reveal, copy path/filename, re-analyze, parent folder filter, remove missing); Cmd+Z / Cmd+Shift+Z undo/redo for favorite/tags/bpm/key/type; settings (play on select, loop, BPM presets, new-file mode, ignore list display, JIT clear, output devices, purge missing); missing banner; README dogfood steps.

**Deferred / thin:** hold-hover binding UI (shown unbound only, no recorder); context menu set type/BPM/key/tags (use toolbar/tag manager + analyze instead); pixel-perfect design chrome; Windows dogfood.

## Next

None for v1. Later: collections, saved searches, Windows validation, analysis tuning.

## SPEC

§4.12 Watch; §4.2 context menu; §4.8 undo; §4.3 hold-hover; §4.1-4.16 remaining Musts; §5 v1 quality bar.
