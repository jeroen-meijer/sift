# Waveform coloring research

Notes from 2026-09-23 while iterating Sift's spectral row/detail waves
(four-band bump on `feat/four-band-waveforms`). Goal: understand why pads
looked all-green, how MiniMeters and DJ apps color waves, and what to try next.

## Sift today

Peakfile **v7** stores four u8 weights per bucket from moodbar STFT energy:

| Band | Hz range | Theme token | Default (Nocturne) |
| --- | --- | --- | --- |
| Bass | &lt; 200 | `--color-wave-bass` | pink `#ff3d8a` |
| Low-mid | 200-1500 | `--color-wave-low-mid` (legacy `--color-wave-mid`) | green `#2ee89a` |
| High-mid | 1500-6000 | `--color-wave-high-mid` | cyan `#40c8e8` |
| Treble | &gt; 6000 | `--color-wave-treble` | violet `#8b7cff` |

UI blend (`blendSpectralRgb`): normalize band shares, raise to **emphasis 3.5**
(winner-take-more), then saturate. Geometry carries amplitude; color does not
encode loudness.

**Why FNF pads were all green (3-band era):** almost all energy sat in the old
single mid band (200 Hz-6 kHz). Softening emphasis to 1.75 did not help pads
and made mixed grooves (pink↔teal chatter) look worse; reverted to 3.5.

**Verified after the mid split** (same pad folder):

| Sample | bass | low-mid | high-mid | treble |
| --- | --- | --- | --- | --- |
| High Pitched Angels | ~1% | ~55% | ~42% | ~2% |
| Blinding Lights | ~0% | ~52% | ~33% | ~15% |
| Creepy Droning | ~10% | ~68% | ~21% | ~1% |

**Bug found during the bump:** analyze queue only checked that a `.peaks` file
*existed*. After v6→v7, readers rejected old files but the queue never rebuilt
them → blank waves, no status-bar progress. Fixed with
`peaks::has_current_peakfile` (header magic+version check).

## MiniMeters (inspected locally)

App: `/Applications/MiniMeters.app`, **v1.0.30** (`com.josephlyncheski.minimeters`).
arm64 slice probed with `strings` / float scans; themes under
`~/Library/Preferences/MiniMeters/themes/`.

### Waveform color modes (docs + binary)

From in-app help strings and [minimeters.app](https://minimeters.app/):

1. **Solid** - one color (`Waveform color is solid`).
2. **Multiband** - "balance between Low, Mid, and High bands." Help:
   "Audio will be split into 3 bands. Low (Red), Mid (Green), High (Blue).
   Some themes select custom colors."
3. **Color Map** - "based on overall volume, mapped to the selected ColorMap."

Peak History overlay (since 0.7.0): RMS of the same three bands
(Fast 1024 / Slow 16384 samples); Red/Green/Blue = Low/Mid/High.

Current preset often has `waveform.color_mode = 1` → Multiband.

### Theme colors (documented; crossovers are not)

`_TEMPLATE.ini` `[Waveform]`:

```ini
low_band = 255, 0, 0
mid_band = 0, 255, 0
high_band = 49, 49, 255
history_low_band / mid / high = classic RGB
```

Themes can remap those (e.g. Light Shard, Shades of Purple). **There is no
theme key for crossover Hz.** Docs never state the cut frequencies.

### Binary probe for cut frequencies

- No adjacent `f32`/`f64`/`i32` pairs for common DJ cuts (200/2000, 250/2000, …).
- No strings `crossover`, `lowpass`, `highpass`, `biquad`.
- "Butterworth" in the binary is a **Syphon license** (Tom Butterworth), not a filter hint.
- Weak signal: `2π·200/44100` as `f64` appears twice (could be coincidence).

**Conclusion:** MiniMeters Multiband is the same *family* as Sift (3-band energy
→ theme RGB), but exact crossovers are opaque without runtime measurement.
Do not assume they match Sift's 200/1500/6000.

### Color Map vs "pretty gaps"

Quieter gaps looking different is often **Color Map** (amp→gradient), not
Multiband. If the user sees low=red and high=blue/other with steady level,
that is Multiband.

## Other apps / libraries

| Source | Approach | Cuts / notes |
| --- | --- | --- |
| **Serato / Rekordbox** | RGB DJ waveform: red low, green mid, blue high | Cuts not officially published |
| **Mixgraph** (Rekordbox-style PNG tool) | Claims club-rig style **200 Hz / 2 kHz** nested band envelopes | Useful prior; not Serato source |
| **Aurora** (Schematic, open source) | Live RGB meter; adjustable crossovers + colour mixer | Defaults **250 Hz / 2000 Hz** (`PluginProcessor.cpp`) |
| **libdjwaveform** | STFT + **continuous frequency→color gradient** (not 3 buckets) | Serato-like look via gradient points |
| **moodbar** (Sift backend) | N-band STFT energy → Classic RGB or themed blend | Sift drives `band_edges_hz` |

Industry consensus for "DJ colored waveforms": **three bands, RGB convention**,
soft additive mix of band energies into one stroke color. Continuous centroid
or amp-colormaps are alternate products, not the Multiband look.

## Calibration fixture

`testdata/spectral-fixtures/band-probe.wav` (~33 s) + `band-probe.md`.

Stepped pure tones (60…12 kHz) with click-count markers, then a 40→16 kHz
chirp. Play into MiniMeters Multiband and screenshot: color flips between
adjacent tones ≈ their crossovers. Same file in Sift checks four-band hue
steps (green→cyan around 1.5 kHz, cyan→violet around 6 kHz).

## Options considered (and status)

| Option | Status |
| --- | --- |
| Soften winner-take-more | Tried (1.75); pads unchanged, grooves uglier → **reverted** |
| Four bands (split mid) | **Shipped on this branch** |
| Five bands | Possible; more theme/tune cost; try after dogfooding four |
| Spectral centroid → hue | Stronger within-band motion; different visual language |
| Amp Color Map mode | Optional second mode; good for rhythm, not timbre |
| Retune 3 cuts only | Trades amen vs pads; four bands is cleaner |

## Suggested next steps

1. Dogfood pads + drums after peakfiles rebuild (status bar should show work).
2. Play `band-probe.wav` in MiniMeters Multiband; note flip points; optionally
   retune Sift edges toward measured MiniMeters cuts if we want closer parity.
3. If pads still feel flat within a file, consider centroid tint *inside* the
   winning band, or a fifth edge (~800 Hz), before another soft-blend pass.
4. Keep Multiband and Color Map as separate mental models; do not mix amp into
   spectral hue by default.
