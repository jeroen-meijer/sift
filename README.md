# Sift

Local desktop sample manager for producers and audio engineers (macOS + Windows).

Product rules: [SPEC.md](SPEC.md). Decision log: [DECISIONS.md](DECISIONS.md). Stack: [docs/TECH_STACK.md](docs/TECH_STACK.md). Plans: [docs/plans/index.plan.md](docs/plans/index.plan.md). Design: [docs/design/](docs/design/).

## Develop

Requires Rust (stable), Bun, and platform Tauri deps (Xcode CLT on macOS).

```bash
bun install
bun run tauri:dev
```

Build:

```bash
bun run tauri:build
```
