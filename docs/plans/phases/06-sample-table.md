# Phase 06 — Sample table

**Status:** complete

## Done

Virtualized table, sort cycle, multi-select, favorites, detail header.

## Previous

Phase 05: samples exist in DB with paths and basic file info stubs.

## This phase

Virtualized sample list/table with sort, multi-select, favorites, and selection driving a detail header stub.

### In scope

- TanStack Virtual (or equivalent) table
- Columns: name, type, BPM, key, waveform placeholder, tags placeholder, favorite
- Sort: click cycles asc → desc → clear (default Name A–Z); persist
- Multi-select: Shift range, ⌘/Ctrl toggle
- Favorite sample toggle
- Selecting a row updates detail pane header (name + path)
- Missing styling stub if `missing` flag exists (full missing behavior in 14)
- Row waveforms column empty/placeholder until Phase 07/09

### Out of scope

- Interactive waveforms, playback, context menu, omni search

## Acceptance

- Scroll stays smooth with indexed `example_samples`
- Sort persists across restart
- Multi-select works; favorite persists

## Next

Phase 07: decode + peakfile generation for waveform drawing.

## SPEC

§4.2 Sample list (minus interactive waveforms and full context menu).
