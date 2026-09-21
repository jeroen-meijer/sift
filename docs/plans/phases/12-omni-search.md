# Phase 12 — Omni search

**Status:** complete

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

## Done

- `OmniSearch` bar above sample table: text + folder/tag/BPM/key chips, clear, ½× / rel toggles
- Folder select sets folder chip; wired to `list_samples` (`text`, `folder_prefix`, `tag_path`/`tag_paths`, bpm/key, half_double, relative_key)
- Name column `<mark>` highlight for text query
- Enharmonic + relative key SQL filters; half/double BPM bands
- Toggles persist via settings `half_double_bpm` / `relative_key`
- Tag facet → chip and BPM/key chip entry UI still light (chips removable; add via state/API ready)

## Next

Phase 13: background analysis (BPM/key/type/auto-tags).

## SPEC

§4.11 Search.
