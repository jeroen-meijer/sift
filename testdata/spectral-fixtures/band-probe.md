# Band probe (MiniMeters / Sift color calibration)

File: `band-probe.wav` (~28 s, stereo 44.1 kHz).

## How to use with MiniMeters

1. Set Waveform **Color Mode → Multiband** (not Color Map).
2. Play this file through the system device MiniMeters is listening to (or MiniMeters Server in a DAW).
3. Screenshot or screen-record the waveform while it plays.
4. Optionally also open the same file in Sift and compare.

## What’s in the file

Before each tone: N short 2 kHz clicks (1…11) so you can count which segment you’re on.

| ≈ start | Hz | intent |
| --- | --- | --- |
| after 1 click | 60 | sub |
| after 2 | 120 | kick-ish |
| after 3 | 200 | low crossover probe |
| after 4 | 400 | low-mid |
| after 5 | 800 | body |
| after 6 | 1500 | mid crossover probe |
| after 7 | 2500 | presence |
| after 8 | 4000 | high-mid |
| after 9 | 6000 | high crossover probe |
| after 10 | 9000 | air |
| after 11 | 12000 | top |
| end | chirp 40→16k | continuous sweep |

## What to look for

- Pure tones should be **one solid band color** in Multiband (default theme: low red, mid green, high blue).
- Where color flips between adjacent tones ≈ MiniMeters’ crossovers.
- The chirp should show a smooth or stepped color transition; note where it changes.

Sift four-band cuts today: **200 / 1500 / 6000 Hz** (bass / low-mid / high-mid / treble).
