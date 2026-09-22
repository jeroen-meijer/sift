# Phase 11: Tags

**Status:** complete

## Previous

Phase 10: drag works; tags may still be placeholders.

## This phase

Hierarchical tags with colors, sample tagging, and dedicated tag management UI (design views Tags / Delete cascade).

### In scope

- Taxonomy CRUD: add, rename, reparent/move, color or inherit, delete with confirm
- Parent delete cascade-deletes children (confirm copy from design)
- Deleting tag strips from all samples
- Sample add/remove tags; hierarchy-aware autocomplete
- Chips show full path + color
- Tag facet panel in sidebar with counts (Should)
- Sticky reject table ready (writing rejects when user removes auto tag : analysis applies in 13)
- Out of v1: merge, reset to defaults

### Out of scope

- Omni search tag chips (Phase 12 : wire facet click to chip if cheap, else 12)
- Auto-tag from filename (Phase 13)

## Acceptance

- Tag management screen matches design intent
- Cascade delete confirm works
- Tags on samples show as full-path chips in table/detail

## Done

- `src-tauri/src/tags.rs`: list/create/rename/move/color/delete + sample tag set/add/remove (auto → `tag_rejects`)
- Commands registered; inherited color resolved for sample chips
- `TagManager` overlay: taxonomy list, add path, cascade delete confirm (locales/tags.json)
- Sample table + detail show full-path colored chips

## Next

Phase 12: omni search field + structured chips.

## SPEC

§4.9 Tags; design views `tags`, `tagdelete`.
