# Phase 04: Library roots + first launch

**Status:** complete

## Done

Add/remove roots via dialog, folder tree sidebar, first-launch Add folder, remove-root confirm. Disk untouched on remove.

## Previous

Phase 03: DB + settings + taxonomy seed.

## This phase

User can add and remove library roots (index only; disk untouched) and see them in the folder sidebar. First-launch CTA works.

### In scope

- `tauri-plugin-dialog` folder picker → insert root
- Remove root with confirm dialog (design: Remove library root); delete related index rows only
- Folder tree listing under each root (from filesystem walk of directories, or from indexed folders : prefer lightweight dir walk for tree UI even before full sample index)
- Favorite folders (toggle, persist)
- Wire first-launch "Add folder…" and sidebar `+`
- Remove-root confirm copy from design

### Out of scope

- Full sample file indexing (Phase 05)
- Watch / missing files

## Acceptance

- Add a local sample folder as a root; it appears in sidebar
- Remove root after confirm; files on disk remain; DB rows for that root gone
- Relaunch restores roots

## Next

Phase 05: recursive audio indexer with ignore list + progress.

## SPEC

§4.1 Library and folders; §4.16 First launch; Q65 remove root.
