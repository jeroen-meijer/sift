# Phase 12: Omni search

**Status:** complete (filters v2)

## Previous

Phase 11: tags and folder tree exist.

## This phase

ADSR-style omni search: fuzzy text + removable chips, typed triggers that open visual editors, type segmented control, Find similar from the sample menu.

### In scope

- Omni field UI (chips + editors)
- Free-text fuzzy on name
- Chips: folder, **one combined tag chip** (include + exclude), BPM range, key
- Type: All / Loops / One-shots toolbar (not a chip)
- Typed triggers: `#`, `b:`/`bpm:`, `k:`/`key:`, `tag:`, `type:`
- Paste/Enter parse of canonical form
- Half/double BPM and relative key toggles (settings defaults + live on chips)
- Enharmonics always match, Camelot input, NOTES display spellings
- Find similar (sample context menu): BPM ±3 and exact key from that sample
- Facet counts in editors (histogram / piano / tag list)
- Recent filters (last 4) in localStorage
- ×2/÷2 and `rel` badges in table cells
- Highlight matches in name column

### Out of scope

- Saved searches / smart collections (canonical `as text` serialisation is the future format)
- Status bar `as text` line (deferred: analyzer owns bottom-right)

## Acceptance

- Typing filters the table; chips narrow further
- Tag chip shows `TAG ● a + ● b + NOT ● c`
- Folder chip recursive; removing chip restores
- Half/double and relative toggles persist
- `tag_exclude_paths` and `key_either` work in `list_samples`

## Done

- `OmniState` reshaped (`tagsInclude`/`tagsExclude`, `OmniKey`, `sampleType`)
- `omniQuery` parse/serialize + `omniKey` NOTES/Camelot
- Editors under `src/components/omni/`
- Backend `tag_exclude_paths` + `key_either`
- Spec §4.11 updated for typed triggers

## Next

Phase 13: background analysis (BPM/key/type/auto-tags).

## Spec

§4.11 Search. Design: `docs/design/omni-search-spec.md`.
