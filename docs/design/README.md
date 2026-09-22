# Claude Design export — Sift sample manager

Visual source of truth for v1 chrome. Behavior conflicts: [SPEC.md](../../SPEC.md) wins.

## Origin

- Zip: `Sift sample manager.zip` (Claude Design export, 2026-09-22)
- Entry: [Sift.dc.html](Sift.dc.html)
- Design system: Nocturne (`_ds/nocturne-*/`)

## How to preview

```bash
cd docs/design
python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/Sift.dc.html
```

Needs network (React/fonts from CDN via `support.js`).

## Screenshots

PNG captures of the design canvas (for quick gap checks without spinning the HTML):

| File | View |
|------|------|
| [screenshots/01-first-launch.png](screenshots/01-first-launch.png) | First launch |
| [screenshots/02-library.png](screenshots/02-library.png) | Library + analyzing row + status progress |
| [screenshots/03-omni-search.png](screenshots/03-omni-search.png) | Omni search chips |
| [screenshots/07-missing-file.png](screenshots/07-missing-file.png) | Missing file banner |
| [screenshots/08-ask-index.png](screenshots/08-ask-index.png) | Ask before index toast |
| [screenshots/09-custom-analysis.png](screenshots/09-custom-analysis.png) | Custom analysis dialog |
| [screenshots/11-settings.png](screenshots/11-settings.png) | Settings |
| [screenshots/12-context-menu.png](screenshots/12-context-menu.png) | Context menu |

## Views (canvas switcher)

| Key | Label |
|-----|-------|
| `first` | First launch |
| `library` | Library populated |
| `search` | Omni search |
| `waveforms` | Row waveforms |
| `clip` | Selection → clip drag |
| `multi` | Multi-select |
| `missing` | Missing file |
| `index` | Ask before index |
| `analysis` | Custom analysis |
| `tags` | Tag management |
| `settings` | Settings |
| `menu` | Context menu |
| `removeroot` | Remove library root |
| `removemissing` | Remove missing |
| `tagdelete` | Delete tag (cascade) |

## Layout (shell)

- Title bar: traffic lights + Settings + Tag management
- Omni search bar with chips + Waveforms / Favorites / Columns toggles
- Left: Folders tree + Tags facet panel
- Center: virtualized sample table (name, type, BPM, key, waveform, tags)
- Bottom: detail dual L/R waveform + transport (loop preview, gain, snap)
- Status bar: roots / indexed / analysis progress

## Row analysis animation (design contract)

When a sample is in the analysis queue:

1. Waveform cell: 4px track (`#22242f`) with a purple shimmer (`siftShimmer`, 1.4s linear infinite, 38% width gradient).
2. Tags cell: italic `Analyzing…` in accent `#9184d9` (no tag chips until done).
3. Status bar (right): `CircleNotch` spinner + `Analyzing N of M` + thin progress bar + `browse and play while this runs`.

Missing rows: warning icon + strikethrough name + dashed waveform stub.

## Tokens (Nocturne)

Key colors from design system: bg `#161826`, text `#e9e9ed`, accent `#9184d9`. Full CSS variables in `_ds/nocturne-*/styles.css`. Icons: Phosphor. Fonts: Inter + JetBrains Mono for mono metadata.
