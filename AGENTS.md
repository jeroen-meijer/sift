# Agent context: Sift

Local sample manager (Tauri 2 + React). Docs map: [docs/README.md](docs/README.md). Product rules: [docs/spec.md](docs/spec.md). Stack: [docs/reference/tech-stack.md](docs/reference/tech-stack.md). Locales: [docs/reference/localization.md](docs/reference/localization.md).

## Prefer clean end state

Prefer the finished shape of the code or docs over a small patch that leaves the old shape intact.

- When extending something that did X so it also does Y, reshape so X and Y read as one design. A later reader should not see that Y was bolted on.
- Delete or merge the old path when the new one replaces it. Touch every call site the clean design needs.
- Do not leave flags, adapters, duplicate branches, rename redirects, or "also call this now" glue that preserves the old structure.
- Temporary QA or dogfood hooks stay local and get removed; they are not product design.
- "Only modify what the task needs" still means do not churn unrelated areas. It does not forbid reshaping the area you are changing.

Applies to Rust, TypeScript, tests, docs, scripts, and agent instruction files in this repo.

## Documentation

Obey [docs/README.md](docs/README.md) for layout, naming, no frontmatter, single source of truth, repo hygiene, lint gates, and persisting durable preferences without being asked. Do not invent parallel trees or dump new markdown at the repo root. Root [README.md](README.md) stays user-facing.

After you edit markdown under `docs/`, root `*.md`, or `assets/**/*.md`, run `bun run docs:check` before you finish. Details: [Lint and validate](docs/README.md#lint-and-validate).

## Settled tooling

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
| Docs lint | `markdownlint-cli2` (`.markdownlint-cli2.jsonc`) + `tool/check-docs.py` via `bun run docs:check` |
| Package manager | Bun |
| CI | `.github/workflows/ci.yml` on Ubuntu (fmt · clippy · nextest · eslint · tsc · vitest · docs:check); Bun+Rust caches; publish on macOS/Windows |
| Release | `CHANGELOG.md` + `./tool/prepare_release.sh` → Publish Release (installers + updater + `latest.json`) |

## Commands

```bash
# Before push / PR (same gates as CI on this machine)
bun run preflight

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
bun run docs:check
bun run build
bun run tauri:dev
bun run tauri:profile
bun run tauri:build

# Version (package.json is canonical; syncs tauri.conf.json + Cargo.toml)
bun run version:sync
bun run version:set 0.2.0
```

Soft perf budgets: `cargo nextest run -E 'test(/^perf_/)' --no-capture`. Watch Clippy: `cd src-tauri && bacon clippy`.

`.vscode/settings.json` runs rust-analyzer Clippy with `-D warnings` and rustfmt on save. Reload the window if diagnostics look stale.

`bun run preflight` runs the same checks as CI on this machine (fmt, clippy, nextest, eslint, tsc, vitest, docs:check). Run it before push when you changed Rust, frontend, docs, or CI config. It does not compile `cfg(not(target_os = "macos"))` code, so keep those stubs tiny (`const fn`, no real logic). CI still catches ubuntu-only Clippy.

App DB (macOS): `~/Library/Application Support/dev.jfk.Sift/library.sqlite3`.

## Changelog / release

`CHANGELOG.md` → `## Upcoming` is the **user-facing draft for the next release**, not a commit diary.

- Write for someone who installs the next version. Conventional prefixes (`feat` / `fix` / `perf` / …) are fine; the rest of the line should read as a product note.
- Unshipped work: edit or merge existing Upcoming bullets. Do not add `fix(X)` under a `feat(X)` that never left Upcoming. Collapse iterative polish into one bullet.
- After a release: only then does a later bugfix get its own Upcoming line.
- Prefer fewer, broader bullets over one line per agent session. Skip internal-only churn unless it changes what users notice.
- Run `/humanize` (or match that skill) on every new or edited Upcoming bullet before you commit.
- Ship: `./tool/prepare_release.sh X.Y.Z` on a clean `main` (moves Upcoming → `## X.Y.Z`, syncs versions, pushes). That commit triggers **Publish Release**.
- Optional PR flow: `./tool/prepare_release.sh X.Y.Z --pr`.
- Retry: Actions → **Publish Release** → Run workflow with the version.
- macOS Apple signing/notarization is optional (unsigned if Apple secrets are absent).
- Updater signing is required on Publish Release. Set repo secrets `TAURI_SIGNING_PRIVATE_KEY` and optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Put the public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Do not commit the private key. For local signed builds, export the same env vars from your secrets manager.
- Release asset helpers: `tool/stage_release_assets.sh` and `tool/finish_github_release.ts`. Keep Tauri's versioned names for the updater (`*_x.y.z_*-setup.exe`, `.app.tar.gz` + `.sig`). Staging also uploads stable hand-install copies with OS in the name (`Sift_macOS_aarch64.dmg`, `Sift_Windows_x64-setup.exe`) so README can use `/releases/latest/download/…` without rewriting URLs each release. Ship `latest.json` plus the `.sig` / updater bundles or the release is incomplete.
- App update endpoint: `https://github.com/jeroen-meijer/sift/releases/latest/download/latest.json`. That URL returns 404 while the repo is private, so in-app updates only work after the repo is public. Dev builds skip the check.
- README download badges: `…/latest/download/Sift_macOS_aarch64.dmg` and `…/latest/download/Sift_Windows_x64-setup.exe`.

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
- Before push: `bun run preflight` when Rust, frontend, or CI-related files changed. Do not push a "fix CI" commit for fmt/clippy/eslint/tsc failures that preflight would have caught.
- No commit/push unless asked (except when the user explicitly requests autonomous delivery).
- No AI-tool credit in commits, PRs, or docs.
