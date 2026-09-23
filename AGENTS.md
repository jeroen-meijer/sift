# Agent context: Sift

Local sample manager (Tauri 2 + React). Product rules: [SPEC.md](SPEC.md). Stack: [docs/TECH_STACK.md](docs/TECH_STACK.md).

## Settled tooling (mirror chat-search where applicable)

| Layer | Choice |
| --- | --- |
| Rust toolchain | nightly via `src-tauri/rust-toolchain.toml` |
| Edition | 2024 |
| Lints | namtao clippy deny set in `src-tauri/Cargo.toml` + `clippy.toml` |
| Watch | `bacon clippy` from `src-tauri/` (`bacon.toml`) |
| Tests (Rust) | `cargo nextest run` (unit tests beside code; `.config/nextest.toml`) |
| Bench (Rust) | Criterion `benches/audio_hotpath.rs` (`cargo bench`) |
| Soft perf guards | `src-tauri/src/perf_budgets.rs` (`perf_*` tests in nextest) |
| Format | `cargo fmt` |
| Frontend lint | ESLint flat + `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` |
| Frontend types | `tsc --noEmit` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Frontend tests | Vitest (`src/**/*.{test,spec}.{ts,tsx}`) |
| Frontend bench | Vitest bench (`bun run bench`, `src/**/*.bench.ts`) |
| Package manager | Bun |
| CI | `.github/workflows/ci.yml` (fmt · clippy · nextest · eslint · tsc · vitest) |
| Release | `CHANGELOG.md` + `./tool/prepare_release.sh` → Publish Release (macOS + Windows) |

## Commands

```bash
# Rust (from src-tauri/)
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo nextest run --all-features
cargo bench --bench audio_hotpath
bacon clippy

# Frontend (repo root)
bun run lint
bun run typecheck
bun run test
bun run bench
bun run build
bun run tauri:dev
bun run tauri:profile
bun run tauri:build

# Version (package.json is canonical; syncs tauri.conf.json + Cargo.toml)
bun run version:sync
bun run version:set 0.2.0
```

## Changelog / release

`CHANGELOG.md` → `## Upcoming` is the **user-facing draft for the next release**, not a commit diary.

- Write for someone who installs the next version. Conventional prefixes (`feat` / `fix` / `perf` / …) are fine; the rest of the line should read as a product note.
- **Unshipped work:** edit or merge existing Upcoming bullets. Do not add `fix(X)` under a `feat(X)` that never left Upcoming. Collapse iterative polish into one bullet.
- **After a release:** only then does a later bugfix get its own Upcoming line.
- Prefer fewer, broader bullets over one line per agent session. Skip internal-only churn (overscan tweaks, temporary flags, profiling hooks) unless it changes what users notice.
- Ship: `./tool/prepare_release.sh X.Y.Z` on a clean `main` (moves Upcoming → `## X.Y.Z`, syncs versions, pushes). That commit triggers **Publish Release** (macOS + Windows installers + GitHub release + tag).
- Optional PR flow: `./tool/prepare_release.sh X.Y.Z --pr`.
- Retry: Actions → **Publish Release** → Run workflow with the version.
- macOS signing/notarization is optional (unsigned if Apple secrets are absent).

## Perf / profiling

- Soft budgets (CI): `cargo nextest run -E 'test(/^perf_/)' --no-capture`
- Detailed timings: `cargo bench --bench audio_hotpath` (decode, peaks, JIT clip, path tokens, heuristic BPM/key)
- UI micro: `bun run bench`
- Interactive release profile: `bun run tauri:profile` then use the app; read `logs/sift-profile.log` (IPC + peaks cache hit/miss + FE round-trips)

## Conventions

- Prefer crates / React packages over custom DSP/OS code.
- Diesel for DB; no hand-written SQL migrations outside `src-tauri/migrations/`.
- Integer boundary: `crate::ids` helpers, not bare `as` (clippy `as_conversions` deny).
- No commit/push unless asked (except when the user explicitly requests autonomous delivery).
- No AI-tool credit in commits, PRs, or docs.
