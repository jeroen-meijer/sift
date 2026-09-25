# Agent context: Sift

Local sample manager (Tauri 2 + React). Product rules: [SPEC.md](SPEC.md). Stack: [docs/TECH_STACK.md](docs/TECH_STACK.md). Locales: [docs/localization.md](docs/localization.md).

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
| CI | `.github/workflows/ci.yml` on Ubuntu (fmt · clippy · nextest · eslint · tsc · vitest); Bun+Rust caches; publish on macOS/Windows |
| Release | `CHANGELOG.md` + `./tool/prepare_release.sh` → Publish Release (installers + updater + `latest.json`) |

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
- Run `/humanize` (or match that skill) on every new or edited Upcoming bullet before you commit. Keep conventional prefixes; the rest should read like a short product note, not a session diary.
- Ship: `./tool/prepare_release.sh X.Y.Z` on a clean `main` (moves Upcoming → `## X.Y.Z`, syncs versions, pushes). That commit triggers **Publish Release** (macOS + Windows installers, updater payloads, `latest.json`, GitHub release + tag).
- Optional PR flow: `./tool/prepare_release.sh X.Y.Z --pr`.
- Retry: Actions → **Publish Release** → Run workflow with the version.
- macOS Apple signing/notarization is optional (unsigned if Apple secrets are absent).
- Updater signing is required on Publish Release. Set repo secrets `TAURI_SIGNING_PRIVATE_KEY` and optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Put the public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Do not commit the private key. For local signed builds, export the same vars (they are also in `~/Dropbox/.shared_configs/vars.env`).
- Release asset helpers: `tool/stage_release_assets.sh` and `tool/finish_github_release.ts`. The Windows updater entry is the NSIS `*-setup.exe`. MSI is for hand installs only. Ship `latest.json` plus the `.sig` / updater bundles or the release is incomplete.
- App update endpoint: `https://github.com/jeroen-meijer/sift/releases/latest/download/latest.json`. That URL returns 404 while the repo is private, so in-app updates only work after the repo is public. Dev builds skip the check.

## Perf / profiling

- Soft budgets (CI): `cargo nextest run -E 'test(/^perf_/)' --no-capture`
- Detailed timings: `cargo bench --bench audio_hotpath` (decode, peaks, JIT clip, path tokens, heuristic BPM/key)
- UI micro: `bun run bench`
- Interactive release profile: `bun run tauri:profile` then use the app; read `logs/sift-profile.log` (IPC + peaks cache hit/miss + FE round-trips)
- Startup: same log; filter `boot.`. Rust milestones are ms since process start; `boot.fe.*` are ms since webview script load. Useful gates: `boot.app_state_init`, `boot.page_load_finished`, `boot.fe.stats_ready`, `boot.fe.ready`, `boot.fe.first_list`. Watch cost shows as `watch.register` (background).

## Conventions

- Prefer crates / React packages over custom DSP/OS code.
- Diesel for DB; no hand-written SQL migrations outside `src-tauri/migrations/`.
- Integer boundary: `crate::ids` helpers, not bare `as` (clippy `as_conversions` deny).
- No commit/push unless asked (except when the user explicitly requests autonomous delivery).
- No AI-tool credit in commits, PRs, or docs.
