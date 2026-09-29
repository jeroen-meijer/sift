# Testing

How to test Sift, how to add tests, and what agents do when asked to verify a feature. Why we picked this E2E stack: [e2e-testing.md](../research/e2e-testing.md).

## Layers

| Layer | Tool | Covers | Command |
| --- | --- | --- | --- |
| Rust unit / soft perf | `cargo nextest` | Engine, DB, IPC helpers, `perf_*` budgets | `cd src-tauri && cargo nextest run --all-features` |
| Frontend unit | Vitest (+ Testing Library) | Parsers, chips, pure UI under `src/**` | `bun run test` |
| Renderer E2E (mocked IPC) | WebdriverIO browser mode | React shell on Vite with mocked `invoke` | `bun run test:e2e:browser` |
| Desktop E2E (real app) | WebdriverIO + `@wdio/tauri-service` embedded | Debug binary with Cargo feature `e2e` | `bun run build:e2e:app` then `bun run test:e2e:tauri` |

Preflight and PR CI run nextest, ESLint, `tsc`, Vitest, and docs checks. Browser E2E is on CI too. Native Tauri E2E stays opt-in (needs a built debug binary and a display). See [CI](#ci).

## Layout

```text
src/**/*.{test,spec}.{ts,tsx}   # Vitest
src-tauri/src/**                # Rust tests beside code
e2e/
  wdio.browser.conf.ts          # Chrome + Vite, mock invoke
  wdio.tauri.conf.ts            # Real Sift binary (embedded WebDriver)
  helpers/                      # Shared mocks / paths
  specs/browser/                # Browser-mode specs
  specs/tauri/                  # Native-mode specs
src-tauri/tauri.e2e.conf.json   # Inlines wdio ACL; only used by build:e2e:app
```

## Choosing a layer

Use the cheapest layer that can fail the claim:

1. Logic, parsing, or pure mapping: Vitest or a Rust unit test next to the module.
2. UI that calls Tauri through `invoke`: WDIO browser mode (`e2e/specs/browser/`).
3. Needs real Rust, disk, or audio: WDIO tauri mode after `build:e2e:app` (`e2e/specs/tauri/`).

Skip desktop E2E when a unit test already covers it.

## Adding tests

### Rust (`cargo nextest`)

- Put `#[cfg(test)] mod tests { … }` at the bottom of the same `.rs` file (see `samples.rs`, `audio/peaks.rs`).
- Soft perf budgets live in `perf_budgets.rs` as `perf_*` tests. Run them with `cargo nextest run -E 'test(/^perf_/)' --no-capture`.
- From `src-tauri/`: `cargo nextest run --all-features` (or a filtered `-E` expression).

### Vitest (frontend unit)

- File next to the module: `foo.ts` → `foo.test.ts` (or `.tsx` / `.spec.ts`).
- Import `describe` / `it` / `expect` from `vitest`. Match existing style (`omniQuery.test.ts`, `format.test.ts`).
- Component tests use Testing Library and `src/test-setup.ts` (jsdom). Prefer behavior over snapshots.
- Run: `bun run test` or `bun run test:watch`.

### WDIO browser mode (renderer E2E)

- Add `e2e/specs/browser/<feature>.spec.ts`.
- For cold start, call `mockEmptyLibraryBoot()` from `e2e/helpers/mockBoot.ts` (or extend that helper) so every `invoke` on the path is mocked.
- Drive the DOM with `$` / `expect` (WebdriverIO). Prefer stable selectors (class or role). Skip brittle copy when a class exists (for example `.first-launch`).
- Run: `bun run test:e2e:browser` (starts Vite in `onPrepare`).

### WDIO tauri mode (real app)

- Add `e2e/specs/tauri/<feature>.spec.ts`.
- Build once: `bun run build:e2e:app` (debug binary + Cargo feature `e2e`).
- Run: `bun run test:e2e:tauri`. Uses a throwaway `HOME` under `tmp/e2e-home` when possible.
- Never turn on the `e2e` feature for release or normal `tauri:dev` builds.

## Cargo feature `e2e`

Opt-in only. It pulls in `tauri-plugin-wdio` and `tauri-plugin-wdio-webdriver`, registers them in `lib.rs`, and (via `tauri.e2e.conf.json`) grants `wdio:default`.

Frontend: `VITE_E2E=1` loads `@wdio/tauri-plugin`. `bun run build:e2e:app` sets that.

## Commands (repo root)

```bash
bun run test                 # Vitest
bun run test:e2e:browser     # WDIO browser mode (starts Vite in onPrepare)
bun run build:e2e:app        # Debug Sift with --features e2e
bun run test:e2e:tauri       # WDIO against that binary (macOS/Windows/Linux)
bun run test:e2e             # browser + tauri (tauri fails fast if binary missing)
bun run typecheck:e2e        # Optional: typecheck the WDIO harness
```

Chromedriver and browser binaries land in `tmp/wdio-cache/` (covered by `tmp/` in `.gitignore`). If a download leaves an empty folder and retries fail, delete that cache and run again.

## CI

- Frontend job in `ci.yml`: Vitest stays required.
- `e2e-browser` job: `bun run test:e2e:browser` on Ubuntu (headless Chrome).
- Native `test:e2e:tauri` is not a required PR gate yet. Run it locally on macOS before shipping shell changes browser mode cannot see.

## Agent rules

These apply to every agent in this repo (Cursor, Claude Code, and similar).

### When you build or change a feature

1. Open this file first if the change is testable.
2. Add or extend automated coverage at the cheapest layer that can fail the claim ([Adding tests](#adding-tests)).
3. Run that layer before you claim the work is done (`bun run test`, targeted nextest, and/or `test:e2e:browser` as needed).
4. Do not leave manual-only checks when a unit or browser test would fit.

### When the user asks you to test, verify, or check a feature

1. Read this file. Do not invent a one-off harness.
2. Prefer adding or extending a test in the repo over a throwaway script.
3. For UI, start with browser mode and `browser.tauri.mock(...)` for every `invoke` on the path. Use or extend `e2e/helpers/mockBoot.ts` for cold start.
4. Move to tauri mode only if the behavior needs real Rust, disk, or audio.
5. Do not say "tested in the real app" unless `test:e2e:tauri` ran (or the user accepted an explicit manual `tauri:dev` checklist).
6. Say what you ran and where the new or updated tests live.

[AGENTS.md](../../AGENTS.md) links here. Keep long samples and recipes in this file only.
