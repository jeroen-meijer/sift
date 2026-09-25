# Splice metadata and analysis enrich

Implementation plan (2026-09-24). Research notes at the end.

When a library file matches Splice Desktop's local `sounds.db`, prefer that catalog's BPM, key, and loop/one-shot over filename guesses and audio heuristics. Do that without always decoding the file. Also: split analysis into stages, add filesystem date columns, and a small Source column. Do not import Splice tags in this pass.

---

## Verdict

Reading `sounds.db` works. It already holds BPM, root + major/minor, sample type, tags, pack, and paths. Offline. Splice does not need to be running. No public API for v1.

On this machine (Studio library):

| Check | Result |
| --- | --- |
| UI vs DB (3 fixtures) | Match (80 / D min, 174 / none, 120 / F min) |
| Studio audio files | 3973 |
| Exact path match | 3827 (96.3%) |
| Plus SHA-256 match | 3844 (96.8%) |
| Rows with BPM / full key | about 55% / 20% (empty key is normal for drums) |

`file_hash` is SHA-256 of the file bytes. Match by path first; hash only on miss (about 1 to 3 ms per file).

WAV/RIFF tags are unreliable (Afro House comment said Gm while Splice said F min). Keep filename tokens (`name_meta`) as fallback. Skip gRPC, GraphQL, and Splice `purchased_at`.

---

## Implementation plan

Five slices. Build order: **A, C, D, B, E**. Stages unlock enrich; Splice and Source are the user-facing win; dates can land in parallel; nuclear reset last.

| | Slice | New? |
| --- | --- | --- |
| A | Analysis stages (peaks-only + non-decode enrich) | Yes (refactor) |
| B | `date_added_ms` / `date_created_ms` | Yes |
| C | Splice `sounds.db` matching | Yes |
| D | Source column (Splice icon) | Yes |
| E | Settings: Refresh metadata + re-analyze entire library | Yes |

Selection Re-analyze / Custom analysis stays for intentional subset work. It is the wrong tool to stamp Splice data across a large library.

---

### A. Analysis stages

Today the queue is binary: `analyzed_at` is null, or the peakfile is missing/outdated. `analyze_sample` always does decode, peaks, filename, heuristic, write. A stale peakfile re-runs creative analysis. After one pass, empty BPM is treated as finished, so the queue will not backfill it.

Do not add per-field `*_analyzed_at` columns. Use stages plus source columns:

| Stage | Needs decode? | Done when |
| --- | --- | --- |
| Catalog / path enrich (Splice, filename) | No | After enrich / index writes per precedence |
| Technical + peaks | Yes | Peakfile is current and technical cols are set |
| Creative audio (heuristic) | Yes | `analyzed_at` is set |
| Tags | Mostly no | Tag rows + rejects (unchanged; no Splice tags yet) |

Pipeline:

1. Peaks-only jobs must not re-run heuristic BPM/key unless Custom analysis says so.
2. Non-decode enrich: Splice can fill empty fields or win by precedence without clearing `analyzed_at` or touching peaks.
3. Track origin with `catalog_source`, `bpm_source`, `key_source`, `sample_type_source`.

This gets you cheap catalog backfill and cheaper peak repairs. It does not improve DSP accuracy or make a full creative decode cheaper.

---

### B. Filesystem dates

Sort by platform times so "new in this folder" and "old files" work after importing an existing library. Do not use Sift's index timestamp as "date added" (everything would share one day).

| DB column | Meaning | macOS | Windows / Linux |
| --- | --- | --- | --- |
| `date_added_ms` | Added to parent folder (Finder Date Added) | `kMDItemDateAdded` / `NSURLAddedToDirectoryDateKey` (same-volume move keeps birthtime, updates Date Added) | No field. Store null and hide the column. Never copy creation into Added. |
| `date_created_ms` | Birth / creation on this volume | `st_birthtime` | CreationTime / birth when available; hide if null |

Keep `mtime_ms` for watch/index. Do not add a Modified table column in this work.

Fill Added/Created on index and on technical refresh/watch. Show Date added and Date created by default when the value is non-null (hide Date added on platforms where it is always null).

Skip Splice `purchased_at`.

On some cloud paths Date Added equals birth (file created in place). Still more useful than an index stamp.

---

### C. Splice matching

#### Behavior

- Open `sounds.db` read-only while Splice is closed (`mode=ro`). On WAL lock, snapshot `sounds.db`, `-wal`, and `-shm`, then open the copy.
- Lookup: `local_path`, else SHA-256 to `file_hash`.
- On hit: set `catalog_source = 'splice'`; write non-empty BPM, key, and sample_type per precedence; set field sources and confidence. Do not import Splice tags in v1.
- On Refresh metadata, if the row was `splice` and no longer matches: clear `catalog_source` only. Leave BPM/key/type. Full wipe is the nuclear reset.
- Never write into Splice's database.

#### Precedence (per field)

`user` > `splice` > `filename` > `audio`

Write when the field is empty, or when the incoming source ranks strictly higher than the current `*_source` (treat null as lowest), or on Custom rerun / nuclear reset.

Same rank does not rewrite. Refresh will not replace a Splice BPM with another Splice BPM. That avoids flicker; catalog edits are rare; nuclear reset is the restart.

An empty Splice field must not clear an existing value.

User edits (`set_sample_bpm`, `set_sample_key`, `set_sample_type`) set the matching `*_source` to `user` and a high confidence.

Splice write confidence: `0.98` (above filename `0.92` / `0.88`).

#### Key mapping

Splice stores two fields. Sift stores analyzer keys as `D`, `Dm`, `F#`, `F#m` (picker labels: `D maj`, `D min`). Filename bare roots like `(D)` already become major (`D`).

| `audio_key` | `chord_type` | Sift `key_name` |
| --- | --- | --- |
| `d` | `minor` | `Dm` |
| `d` | `major` | `D` |
| `f#` | `minor` | `F#m` |
| `d#` | empty | `D#` (treat as major, same as bare filename roots) |

Do not add a third "root with no mode" key type. Empty `chord_type` means major. That matches `name_meta` and the key picker (`value: "D"` is maj). Some oneshots are only a pitch class; calling them major is imperfect but consistent.

`sample_type`: `loop` to `loop`, `oneshot` to `one-shot`.

#### Schema (same migration as dates)

| Column | Type | Notes |
| --- | --- | --- |
| `catalog_source` | `TEXT NULL` | `null` or `splice` (catalog join only) |
| `bpm_source` | `TEXT NULL` | `user`, `splice`, `filename`, or `audio` |
| `key_source` | `TEXT NULL` | same |
| `sample_type_source` | `TEXT NULL` | same |
| `date_added_ms` | `BIGINT NULL` | |
| `date_created_ms` | `BIGINT NULL` | |

Every creative field that can come from more than one place gets a `*_source` column. Defer `splice_file_hash` and `splice_pack_uuid`.

Do not name a sample column `source` (clashes with `sample_tags.source`).

#### Code

```text
src-tauri/src/splice/
  mod.rs
  detect.rs    // macOS + Windows Application Support paths
  catalog.rs   // rusqlite RO open, path/hash lookup
  map.rs       // key/type/confidence (no tags in v1)
```

Use rusqlite for the foreign DB. Do not attach it to Sift's Diesel pool.

#### Settings (Splice)

- Toggle: Use Splice metadata when available (default on if a DB is found).
- Status line: DB path, row count, last open ok/error.
- Auto-detect only. No file picker in v1.
- Turning the toggle on runs Refresh metadata once.
- Persist toggle and resolved path in Sift settings.

Detect paths:

- macOS: `~/Library/Application Support/com.splice.Splice/users/default/*/sounds.db`
- Windows (best effort): `%APPDATA%\com.splice.Splice\users\default\*\sounds.db` and `%LOCALAPPDATA%\com.splice.Splice\…` (same Electron `com.splice.Splice` layout as macOS). Support docs also mention `Local\Splice` / `Local\SpliceSettings` for app files; the samples DB is still expected under `com.splice.Splice`. If missing, leave the toggle off and show unavailable in status.

Optional: read sibling `settings.json` for `splice_folder`.

#### When enrich runs

- Index of a new local file (path only; hash only if bytes are local).
- Full `analyze_sample` (before filename/audio merge).
- Settings Refresh metadata.
- Enabling the Splice toggle (one automatic Refresh).

---

### D. Source column

- Default order: Name, Source, Type, then the rest. Fav star stays pinned left.
- Cell: Splice icon when `catalog_source = 'splice'`; otherwise empty.
- Hideable and reorderable like other content columns.
- Not resizable. Fixed width about the "Source" header (icon is smaller). Extend the column model past today's `ResizableColumn` list: fixed track like fav, still in order/hidden state.
- Default visible. No BPM/key source badges. No detail-pane Splice text.

Icon: same approach as `RowIcons.tsx` (static path, `fill="currentColor"`). Source: [Splice_logo_clean.svg](https://commons.wikimedia.org/wiki/File:Splice_logo_clean.svg). Trim the viewBox, minify, inline as `RowSpliceIcon`. aria-label / tooltip: `Splice` when the icon is shown.

---

### E. Settings: Refresh metadata and full reset

#### Refresh metadata

Settings label: **Refresh metadata** (not Splice-branded).

When Splice is enabled, run non-decode catalog enrich (path/hash match, write per precedence). Do not re-parse filenames (analyze/index already does that). No wipe. No full-library decode.

This is how you backfill after shipping or after new Splice downloads.

#### Re-analyze entire library

Red control. Confirm dialog with one clear destructive button (for example **Erase analysis data**). No typed phrase.

Wipe: BPM, key, type, confidences, `catalog_source`, `bpm_source`, `key_source`, `sample_type_source`, auto tags, `analyzed_at`, peakfiles.

Keep: favorites, user tags, tag rejects, folder favorites, roots, UI prefs.

Dialog copy must say that user-edited BPM and key are wiped too.

Then enqueue full analyze for all local samples (includes Splice enrich if enabled). Progress uses the existing status bar.

Do not tell people to select all and Analyze for either job.

---

### Tests

- Key and type mapping; precedence matrix including enrich-only writes. No tag-import tests in v1.
- Fixture `sounds.db`: path and hash lookup; lost match clears `catalog_source` on refresh.
- Dates: null Added hides the column; Created when present.
- Source column: fixed width; hide/reorder; icon only for `catalog_source = 'splice'`.
- Optional: `SIFT_SPLICE_DB` ignore-gated smoke test against a real DB.

---

### Out of scope (v1)

- gRPC, GraphQL, scraping the Splice UI
- `purchased_at`, pack art, writing back to Splice
- Trusting WAV RIFF for BPM/key
- Per-field analyzed-at timestamps
- Faking Date added on Windows/Linux
- More Splice UI than the Source icon
- Splice to Sift tag mapping / tag import
- Keeping user BPM/key across nuclear reset

---

### Ship checklist

1. Migration: source columns + date columns
2. Analysis stages: peaks-only path + enrich hook
3. Splice module, detect, toggle, analyze/enrich precedence (no tags)
4. Refresh metadata
5. Source column + `RowSpliceIcon`
6. Date capture + columns (hide Added when null)
7. Nuclear re-analyze
8. Tests + CHANGELOG Upcoming

---

### Risks

| Risk | What to do |
| --- | --- |
| Private DB layout or path changes | Detect and show status; do not crash if missing |
| Windows path differs | Auto-detect; if missing, Splice unavailable on that OS |
| WAL lock while Splice writes | Read-only open; snapshot fallback |
| Odd Date Added on cloud volumes | Allow null; do not block index |
| ToS gray area reading `sounds.db` | Same-user machine, read-only |

### Decisions (2026-09-24)

1. Date Added and Created columns visible by default (hide when null).
2. No Modified column in this work.
3. Auto-detect `sounds.db` only (no file picker in v1).
4. Turning Splice on runs Refresh metadata once.
5. Refresh metadata = Splice catalog match for BPM, key, and type. No tags. No filename re-parse.
6. Write only into empty fields or from a strictly higher source. No same-rank rewrite.
7. Map `audio_key` + `chord_type` to Sift `D` / `Dm` / …. Empty mode assumes major. No root-without-mode type.
8. No Splice tag import in v1.
9. Provenance: `bpm_source`, `key_source`, `sample_type_source`, plus `catalog_source`.
10. Nuclear confirm: red button dialog, not a typed phrase.
11. Windows: best-effort detect. Path can be checked on a Windows PC with the script below.

### Windows check

On a PC with Splice installed, run this in PowerShell and paste the output, or copy the listed files:

```powershell
Write-Host "APPDATA=$env:APPDATA"
Write-Host "LOCALAPPDATA=$env:LOCALAPPDATA"
$roots = @(
  "$env:APPDATA\com.splice.Splice",
  "$env:LOCALAPPDATA\com.splice.Splice",
  "$env:APPDATA\Splice",
  "$env:LOCALAPPDATA\Splice"
)
foreach ($r in $roots) {
  Write-Host "`n--- $r ---"
  if (Test-Path $r) { Get-ChildItem $r -Force | Select-Object Name, Mode, Length, LastWriteTime }
  else { Write-Host "(missing)" }
}
Write-Host "`n=== sounds.db ==="
Get-ChildItem -Path "$env:APPDATA","$env:LOCALAPPDATA" -Filter sounds.db -Recurse -ErrorAction SilentlyContinue |
  Select-Object FullName, Length, LastWriteTime
Write-Host "`n=== settings.json near Splice ==="
Get-ChildItem -Path "$env:APPDATA\com.splice.Splice","$env:LOCALAPPDATA\com.splice.Splice" -Filter settings.json -Recurse -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host $_.FullName; Get-Content $_.FullName -Raw }
Write-Host "`n=== port.conf ==="
Get-ChildItem -Path "$env:APPDATA\com.splice.Splice","$env:LOCALAPPDATA\com.splice.Splice" -Filter port.conf -Recurse -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host $_.FullName; Get-Content $_.FullName -Raw }
```

Send back: full path(s) to `sounds.db`, `settings.json` (especially `splice_folder`), and whether Splice was open. Optional: copy `sounds.db` and `settings.json` for offline inspection (read-only; settings may include email/paths).

---

## Background research

### Approaches

1. `sounds.db` (chosen): offline, accurate. Also used by LivePilot and Splorganizer.
2. Filename tokens: already in Sift; fallback.
3. WAV/RIFF/ID3: weak or wrong; do not prefer.
4. Localhost gRPC: same fields, needs the app open; later optional.
5. GraphQL: auth, ToS, network; skip for local accuracy.

### `sounds.db` layout

```text
~/Library/Application Support/com.splice.Splice/users/default/<user>/sounds.db
```

Useful columns: `local_path`, `file_hash`, `filename`, `audio_key`, `bpm`, `chord_type`, `sample_type`, `tags`, `pack_uuid`. Sibling `settings.json` has `splice_folder`. WAL files appear while the app is running.

Proto lives at `/Applications/Splice.app/Contents/Resources/app/proto/app.proto` when Splice is installed in the default macOS location.
