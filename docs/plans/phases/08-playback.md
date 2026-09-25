# Phase 08: Playback

**Status:** complete

## Done

cpal PlayerEngine, play-on-select, Enter/Space/arrows, loop preview.

## Previous

Phase 07: peaks drawn; no audio out.

## This phase

Rust `cpal` preview engine with SPEC transport: play-on-select, Enter/Space, Up/Down, loop preview, gain, output device.

### In scope

- Device list + Default; persist choice
- Play/stop/pause/seek from start or position
- Play on select (setting); interrupt cleanly on selection change
- Enter = play from start; Space = pause/resume (restart if finished)
- Up/Down move selection like click (respect play-on-select); aim near-instant (prefetch decode)
- Loop preview sticky: On → loops loop, one-shots once; Off → always once; default On
- Preview gain (UI only; never bake into files)
- Transport strip in detail pane (design)

### Out of scope

- Hold-to-hover hotkey (can finish in 14)
- Waveform selection / JIT
- Pitch/tempo stretch

## Acceptance

- Rapid Up/Down through a local library feels snappy; no ~0.5s hitch
- Gain and loop toggle behave per SPEC
- Switching output device works (or reports clear error)

## Next

Phase 09: interactive waveforms, snap, selection region.

## SPEC

§4.3 Playback and keyboard; §4.5 Preview audio.
