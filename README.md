# Sift

Local desktop sample manager for producers and audio engineers (macOS + Windows).

Product rules: [SPEC.md](SPEC.md). Decision log: [DECISIONS.md](DECISIONS.md). Stack: [docs/TECH_STACK.md](docs/TECH_STACK.md). Plans: [docs/plans/index.plan.md](docs/plans/index.plan.md). Design: [docs/design/](docs/design/).

## Dogfood (v1)

Requires Rust (stable), Bun, and platform Tauri deps (Xcode CLT on macOS).

```bash
bun install
bun run tauri:dev
```

Then in the app:

1. Add folder → choose `example_samples/` (or any sample root).
2. Browse the table, play with ↑↓ / Enter / Space, search via the omni field.
3. Tag samples, favorite, right-click for Open / Reveal / Re-analyze / parent folder filter.
4. Drag a row (full files) or a waveform selection (JIT clip) into a DAW.
5. Copy a new audio file into a watched root → it should auto-index (or ask, per Settings).

If you previously ran a pre-Diesel build and the app fails on migrate, delete the old DB once:

```bash
rm -f ~/Library/Application\ Support/dev.jfk.Sift/library.sqlite3*
```

(That only removes Sift’s index; sample files on disk are untouched.)

Build:

```bash
bun run tauri:build
```

Frontend-only typecheck/bundle:

```bash
bun run build
```
