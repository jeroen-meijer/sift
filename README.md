# Sift

Local desktop sample manager for producers and audio engineers (macOS + Windows).

Product rules: [SPEC.md](SPEC.md). Decision log: [DECISIONS.md](DECISIONS.md). Stack: [docs/TECH_STACK.md](docs/TECH_STACK.md). Plans: [docs/plans/index.plan.md](docs/plans/index.plan.md). Design: [docs/design/](docs/design/). Agent/tooling notes: [AGENTS.md](AGENTS.md).

## Dogfood (v1)

Requires Bun, Xcode CLT, and Rust **nightly** (pinned by `src-tauri/rust-toolchain.toml`).

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

## Lint, test, build

```bash
# Frontend
bun run lint
bun run typecheck
bun run test
bun run build

# Rust (from src-tauri/)
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo nextest run --all-features

# App package
bun run tauri:build
```

Watch Clippy: `cd src-tauri && bacon clippy`.
