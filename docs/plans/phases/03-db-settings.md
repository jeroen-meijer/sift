# Phase 03 — DB + settings

**Status:** in_progress

## Previous

Phase 02: themed shell + i18n + first-launch chrome (no data).

## This phase

Embed SQLite and persist settings; seed default tag taxonomy; expose get/set settings and basic DB health over IPC.

### In scope

- `rusqlite` (bundled) DB in app data dir
- Schema: `roots`, `folders` (optional denorm), `samples`, `tags`, `sample_tags`, `tag_rejects`, `favorites` (samples + folders), `settings` (key/value JSON), `undo_stack` (or equivalent), schema migrations
- Seed tags from [docs/DEFAULT_TAXONOMY.md](../../DEFAULT_TAXONOMY.md)
- Default settings: play-on-select on, loop preview on, snap 1/4, BPM range 70–180, auto-index, row waveforms on, dark theme, ignore list defaults
- App dirs: data, cache/clips, peakfiles
- Tauri commands: `get_settings`, `set_setting`, `db_stats` (roots/samples counts)

### Out of scope

- Adding roots from UI, scanning files, playback

## Acceptance

- Cold start creates DB + seeds taxonomy
- Settings round-trip across restart
- Status bar can read real `0 roots` counts from DB

## Next

Phase 04: add/remove library roots + first-launch Add folder.

## SPEC

§4.8 Metadata storage; §4.9 Tags (seed); §4.5/4.7 defaults that live in settings.
