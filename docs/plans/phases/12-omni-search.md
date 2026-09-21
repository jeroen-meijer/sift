# Phase 12 — Omni search

**Status:** pending

## Previous

Phase 11: tags and folder tree exist.

## This phase

ADSR-style omni search: fuzzy text + removable chips; toggles; match highlighting.

### In scope

- Omni field UI (design: search bar with chips)
- Free-text fuzzy on name (and cheap text fields)
- Chips: folder (recursive), tag, BPM range, key, type (Should)
- Folder browser click → folder chip
- Tag facet click → tag chip
- Half/double BPM toggle default Off, inline, persist
- Relative major/minor include toggle default Off, inline, persist
- Enharmonics always match (`Gb` ≡ `F#`)
- Highlight matches in name column
- Clear query control

### Out of scope

- Query language; saved searches

## Acceptance

- Typing filters the table; chips narrow further
- Folder chip recursive; removing chip restores
- Half/double and relative toggles persist

## Next

Phase 13: background analysis (BPM/key/type/auto-tags).

## SPEC

§4.11 Search.
