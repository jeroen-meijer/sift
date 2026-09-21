# Phase 02 — Shell, theme, i18n

**Status:** complete

## Done

Nocturne theme tokens, i18next locales (en), TitleBar / FirstLaunch / StatusBar / AppShell. Settings and Tags are stub overlays.

## Previous

Phase 01: empty Tauri + React app builds.

## This phase

Wire dark theme tokens, English locales, and static app chrome that matches the Claude Design shell (title bar actions, first-launch empty state, status bar stub).

### In scope

- `src/themes/dark-default.css` — Nocturne CSS variables from `docs/design/_ds/nocturne-*/styles.css`
- Components use `var(--…)` only (no hardcoded hex in TSX)
- `i18next` + `react-i18next`; strings in `src/locales/en/*.json`
- Layout: macOS-ish chrome, Settings/Tags icon buttons (stubs), first-launch panel (“Point Sift at your samples”), empty sidebar, status bar (`0 roots · 0 files`)
- Phosphor icons (or equivalent) as in design

### Out of scope

- Real folder picker / DB / indexing
- Sample table data
- Settings/tags screens beyond navigation stubs

## Acceptance

- App opens to first-launch UI matching design intent
- Changing a locale key updates visible copy; changing a theme token recolors UI
- No user-facing English hardcoded in components

## Next

Phase 03: SQLite schema, settings store, taxonomy seed.

## SPEC

§4.13 Appearance; §4.14 Localization; §4.16 First launch (UI only).
