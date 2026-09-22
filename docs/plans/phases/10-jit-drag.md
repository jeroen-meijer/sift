# Phase 10: JIT + drag

**Status:** complete

## Done

JIT WAV clips via hound; `render_jit_clip` / `clear_jit_cache` / `start_drag_files`; tauri-plugin-drag; Drag files / Drag clip buttons.

### In scope

- List drag: current multi-selection as full unaltered file paths (`tauri-plugin-drag`)
- Selection-box drag: render JIT WAV matching source rate/bit depth/channels (`hound`); name `{original}_clip_{start}-{end}.wav` (+ disambiguator)
- Outside selection / no selection: no file drag
- Cache dir path in settings; Clear cache; no auto-delete on quit
- No embedded cue/BPM/key in dragged files
- Preview gain must not affect JIT

### Out of scope

- Windows SMB edge-case hardening beyond best effort

## Acceptance

- Drag a file from the list into Finder (and a DAW if available) succeeds
- Drag selection creates a clip file under cache and starts drag
- Clear cache removes JIT files

## Next

Phase 11: hierarchical tags + management UI.

## SPEC

§4.6 Drag to DAW; §6 JIT summary.
