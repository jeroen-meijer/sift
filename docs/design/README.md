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

## Tokens (Nocturne)

Key colors from design system: bg `#161826`, text `#e9e9ed`, accent `#9184d9`. Full CSS variables in `_ds/nocturne-*/styles.css`. Icons: Phosphor. Fonts: Inter + JetBrains Mono for mono metadata.
