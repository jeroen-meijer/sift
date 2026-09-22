# Phase 13: Analysis

**Status:** complete

## Previous

Phase 12: search works; creative metadata mostly empty/manual.

## Done

Background analysis never blocks UI: file info, BPM, key, loop/one-shot, path/filename auto-tags; normal + custom re-analyze.

- `analyze` module: `Analyzer` trait, `PathTokenAnalyzer`, `HeuristicAnalyzer` (`stratum-dsp` + envelope fallback)
- Worker thread + `analysis-progress` events; enqueue unanalyzed after `add_root` / reindex
- Sticky `tag_rejects`; non-null BPM/key/type treated as overrides unless Custom rerun flags
- Commands: `analyze_samples`; Custom analysis dialog + BPM range presets in settings
- Phase 14 note: on modify-watch, technical probe only; keep creative overrides

### In scope

- Worker pool + progress events (per-sample / global)
- File info: sample rate, bit depth, channels, duration, format
- `trait Analyzer`: spike `stratum-dsp` for BPM/key; low confidence → unknown; loop vs one-shot heuristic OK
- Auto-tags from filename/path tokens → default taxonomy; sticky rejects honored
- User overrides win; UI shows effective values only
- Normal re-analyze (forced): refresh technical + non-overridden autos; no rejected tags back
- Custom analysis dialog (design): overwrite tags, re-run BPM/key/type; BPM range linked to settings
- BPM range presets: 60-150, 68-135, 70-180 (default), 90-180, 98-195
- After modify re-analyze later (watch): keep overrides; document hook for Phase 14

### Out of scope

- Audio-based ML tagging; perfect BPM on all one-shots

## Acceptance

- Indexing `example_samples` fills many BPM/key/tags without freezing UI
- Custom analysis dialog runs on multi-select
- Removing an auto tag sticks across normal re-analyze

## Next

Phase 14: filesystem watch, missing files, context menus, undo, settings polish, dogfood.

## SPEC

§4.7 Analysis; §4.8 overrides; DEFAULT_TAXONOMY auto-tag notes.
