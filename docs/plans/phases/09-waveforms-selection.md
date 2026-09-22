# Phase 09: Waveforms + selection

**Status:** complete

## Done

Click-to-seek, drag selection region on detail waveform. Snap/Z polish deferred to 14 if thin.

## Previous

Phase 08: preview plays; waveforms are static.

## This phase

Interactive row and detail waveforms: click-to-play-from, hover cursor, selection region, beat snap, Shift/Z modifiers, playhead.

### In scope

- Row: click plays from position; hover vertical cursor
- Detail: click sets playhead + can play; drag selection; adjustable edges
- Snap: None / 1/4 / 1/8 / 1/16 (default 1/4); markers when BPM known; unknown BPM → silent free-time
- Hold Shift = temporary free-time; Hold Z = zero-crossing; Shift+Z together
- Stereo dual L/R default; settings mono/summed toggle (wire to settings)
- Visible playhead while playing
- Selection state held in UI/Rust for Phase 10 JIT

### Out of scope

- Drag-out / JIT file write (Phase 10)
- Clear selection menu item (out of v1)

## Acceptance

- Can select a region on a loop with known/unknown BPM
- Shift disables snap; Z snaps edges to zero crossings when samples available
- Row click starts playback mid-file

## Next

Phase 10: JIT clip render + native drag to DAW.

## SPEC

§4.4 Waveforms; §4.2 row waveform interaction; Shift context note.
