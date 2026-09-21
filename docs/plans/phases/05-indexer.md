# Phase 05 — Indexer

**Status:** in_progress

## Previous

Phase 04: roots in DB and sidebar; no sample rows yet.

## This phase

Recursively index audio files under each root into SQLite with progress events; respect ignore list.

### In scope

- Supported extensions: wav, aiff/aif, flac, mp3, aac/m4a, ogg, opus
- Ignore list from settings (defaults: `.git`, `node_modules`, `.DS_Store`, common junk)
- Insert/update `samples` with path, filename, size, mtime, inode if available; technical fields nullable until analysis
- Background indexing (tokio); emit progress events; UI status bar / non-blocking progress
- Re-index root on add; command to re-scan
- Test with `example_samples/`

### Out of scope

- Continuous watch (Phase 14)
- BPM/key analysis (Phase 13)
- Peak generation (Phase 07) — optional stub queue OK but not required

## Acceptance

- Adding `example_samples` indexes dozens of files without freezing UI
- Counts in status bar update
- Ignored paths skipped
- Non-audio files not indexed

## Next

Phase 06: virtualized sample table + selection.

## SPEC

§4.12 indexing parts; §4.15 Formats; §4.1 ignore list.
