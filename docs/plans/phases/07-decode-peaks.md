# Phase 07: Decode + peaks

**Status:** complete

## Done

Symphonia decode, peakfile cache, get_peaks IPC, WaveformCanvas draw.

## Previous

Phase 06: sample table shows metadata; no real waveforms.

## This phase

Decode audio via Symphonia; build peak buffers for row and detail views; cache peakfiles on disk.

### In scope

- Shared decode path → interleaved samples + stream info (rate, bit depth, channels, duration)
- Peakfile format (engineering choice; document briefly): downsample min/max per bucket, stereo lanes
- Worker queue generating peaks after index / on demand
- IPC: `get_row_peaks(sample_id)`, `get_detail_peaks(sample_id, width)` returning typed arrays / base64 / binary-friendly payload (avoid huge JSON if possible; `tauri` bytes or chunked)
- Draw static row + detail waveforms from peaks (no playhead/selection yet)

### Out of scope

- Playback, selection drag, snap markers interaction

## Acceptance

- Selecting a WAV/MP3/FLAC from `example_samples` shows detail waveform
- Row waveforms appear when toggle on (default on)
- Regenerating peaks does not block UI

## Next

Phase 08: cpal preview playback + transport.

## SPEC

§4.4 Waveforms (drawing); §4.15 decode formats; TECH_STACK peakfiles.
