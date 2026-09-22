# Agent context: Sift

Local sample manager (Tauri 2 + React). Product SoT: [SPEC.md](SPEC.md). Stack: [docs/TECH_STACK.md](docs/TECH_STACK.md).

## Settled tooling (mirror chat-search where applicable)

| Layer | Choice |
| --- | --- |
| Rust toolchain | nightly via `src-tauri/rust-toolchain.toml` |
| Edition | 2024 |
| Lints | namtao clippy deny set in `src-tauri/Cargo.toml` + `clippy.toml` |
| Watch | `bacon clippy` from `src-tauri/` (`bacon.toml`) |
| Tests (Rust) | `cargo nextest run` (unit tests beside code; `.config/nextest.toml`) |
| Format | `cargo fmt` |
| Frontend lint | ESLint flat + `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` |
| Frontend types | `tsc --noEmit` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Frontend tests | Vitest (`src/**/*.{test,spec}.{ts,tsx}`) |
| Package manager | Bun |
| CI | `.github/workflows/ci.yml` (fmt · clippy · nextest · eslint · tsc · vitest) |

## Commands

```bash
# Rust (from src-tauri/)
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
cargo nextest run --all-features
bacon clippy

# Frontend (repo root)
bun run lint
bun run typecheck
bun run test
bun run build
bun run tauri:dev
```

## Conventions

- Prefer crates / React packages over custom DSP/OS code.
- Diesel for DB; no hand-written SQL migrations outside `src-tauri/migrations/`.
- Integer boundary: `crate::ids` helpers, not bare `as` (clippy `as_conversions` deny).
- No commit/push unless asked (except when the user explicitly requests autonomous delivery).
- No AI-tool credit in commits, PRs, or docs.
