# Phase 01: Scaffold

**Status:** complete

## Done

Tauri 2 + React 19 + Vite 8 + Bun app at repo root. `bun run build` and `cargo check` pass. Scripts: `tauri:dev` / `tauri:build`.

## Previous

Repo has SPEC, tech-stack, default-taxonomy, Claude Design under `docs/design/`, and `example_samples/`. No app code yet.

## This phase

Create a Tauri 2 + React 19 + TypeScript + Vite + Bun desktop app at the repo root (loudline-shaped layout) that builds and opens an empty window.

### In scope

- `package.json` with Bun scripts: `dev`, `build`, `tauri:dev`, `tauri:build`, lint
- Vite + React 19 + TS
- `src-tauri/` with Tauri 2, minimal `lib.rs` / `main.rs`, `tauri.conf.json`, icons
- `.gitignore` for `node_modules`, `dist`, `src-tauri/target`, `.venv`, etc.
- README note: how to run `bun install && bun run tauri:dev`
- Align versions roughly with [loudline](https://github.com/jeroen-meijer/loudline) (Tauri 2.x, React 19, Bun)

### Out of scope

- Product UI, themes beyond a blank dark page, SQLite, audio, any SPEC features

## Acceptance

- `bun install` succeeds
- `bun run tauri:dev` opens a window (or `bun run build` + `cargo check` in `src-tauri` if GUI session is awkward; prefer actual window)
- Repo root is the app; docs remain under `docs/`

## Next

Phase 02: Nocturne theme tokens, i18n, shell chrome matching first-launch/library frames.

## SPEC

§5 stack bias; TECH_STACK recommendation.
