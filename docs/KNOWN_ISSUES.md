# Known issues

Open problems found while dogfooding. Newest first. Remove an entry when its fix lands (mention the fix in `CHANGELOG.md`).

## Row waveforms flash grey or blank while scrolling fast

Found 2026-09-23 during the Phase A profile run, scrolling the full `samples` folder (5,000 rows) with waveforms on.

Status 2026-09-23 (afternoon):

- Paint-budget no longer `clearRect`s a correct wave (that regression is fixed).
- Lite/fast-scroll mode is gone. It hid tags and icons until about 100 ms after scroll and felt like pop-in. Rows stay fully drawn.
- Overscan is 40; peaks prefetch pad is 12; canvas uses `willReadFrequently`.
- Profile marks for voids: `fe.void_scroll`, `fe.void`, `fe.scroll` (`gap=`). In a recent dogfood stretch, `gap` stayed 0 while chrome still "popped". That was lite mode, not missing rows. If voids remain with `gap=0` after a restart, check WebKit Layers (checkerboarding).
- Hard flicks can still show one frame of empty row lines (browser vs React). The row-line tile softens the black void.

## Whole-library list still capped at 25 000

Found 2026-09-23. With no folder selected the table now lists samples (was "Select a folder"). `list_samples` still uses `limit: 25000`, so libraries larger than that need the windowed list (D3 in the V3 spec).
