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

**Conclusion (pre-probe):** MiniMeters Multiband is the same *family* as Sift
(band energy → theme RGB), but exact crossovers needed a runtime measure.

### Color Map vs "pretty gaps"

Quieter gaps looking different is often **Color Map** (amp→gradient), not
Multiband. If the user sees low=red and high=blue/other with steady level,
that is Multiband.

### Probe results (2026-09-25)

Played `band-probe.wav` into MiniMeters Multiband (default-ish RGB theme).
Click-count markers identify each pure tone.

| Clicks | Hz | Observed Multiband color | Band read |
| --- | --- | --- | --- |
| 1 | 60 | deep red / maroon | Low |
| 2 | 120 | orange-red | Low (soft lean toward mid) |
| 3 | 200 | yellow-orange | Low+Mid blend |
| 4 | 400 | solid lime green | Mid |
| 5 | 800 | solid green | Mid |
| 6 | 1500 | cyan | Mid+High blend |
| 7+ | 2500…12k | solid blue | High |

Chirp (waveform strip): continuous soft rainbow **red → orange → yellow →
green → cyan → blue** as frequency rises. That is soft 3-band Multiband
mixing, not four discrete Sift hues.

Spectrogram panel in the same capture uses a separate continuous freq→hue
colormap (purple→red→yellow). Do not confuse that with Multiband.

**Inferred MiniMeters cuts (soft, ±100 Hz):**

- Low ↔ Mid ≈ **200–250 Hz**
- Mid ↔ High ≈ **1.5–2 kHz**

Matches Aurora defaults (250 / 2000) and DJ folklore (200 / 2000) much better
than Sift’s four-band 200 / 1500 / 6000. MiniMeters stays at **three** bands;
Sift’s extra high-mid/treble split is what made pads differ, but it will not
match MiniMeters’ blue-by-~2.5 kHz behavior.

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

`testdata/spectral-fixtures/band-probe.wav` (~33 s, stereo 44.1 kHz).

Stepped pure tones with N short 2 kHz clicks before each segment (count the
clicks to know which tone), then a 40→16 kHz chirp:

| After clicks | Hz | Intent |
| --- | --- | --- |
| 1 | 60 | sub |
| 2 | 120 | kick-ish |
| 3 | 200 | low crossover probe |
| 4 | 400 | low-mid |
| 5 | 800 | body |
| 6 | 1500 | mid crossover probe |
| 7 | 2500 | presence |
| 8 | 4000 | high-mid |
| 9 | 6000 | high crossover probe |
| 10 | 9000 | air |
| 11 | 12000 | top |
| end | chirp 40→16k | continuous sweep |

**Replay in MiniMeters:** Waveform Color Mode → Multiband (not Color Map).
Play through the device MiniMeters is listening to (or MiniMeters Server in a
DAW). Screenshot or screen-record while it plays; optionally open the same
file in Sift and compare. Pure tones should read as one solid band color;
where color flips between adjacent tones ≈ MiniMeters' crossovers.

Probe completed 2026-09-25 (see MiniMeters section above). Sift four-band cuts
today: **200 / 1500 / 6000 Hz**.

## Options considered (and status)

| Option | Status |
| --- | --- |
| Soften winner-take-more | Tried (1.75); pads unchanged, grooves uglier → **reverted** |
| Four bands (split mid) | **Shipped**; pads look better in Sift |
| Align cuts with MiniMeters (~250 / 2k, 3-band) | Would match MM chirp; would likely flatten pads again |
| Keep four bands, retune edges toward MM mid/high | Possible compromise (e.g. 250 / 1200 / 2500) |
| Spectral centroid → hue | Stronger within-band motion; different visual language |
| Amp Color Map mode | Optional second mode; good for rhythm, not timbre |

## Suggested next steps

1. Decide product goal: MiniMeters parity (3-band ~250/2k) vs pad differentiation
   (keep four bands). Those pull in opposite directions.
2. If keeping four bands: optional retune of the mid/high edges after more
   dogfood; do not chase MM’s early blue unless we drop a band.
3. Centroid tint inside the winning band if within-file pad motion still feels flat.
4. Keep Multiband and Color Map as separate mental models; do not mix amp into
   spectral hue by default.
