# Sift v1 implementation rules

Read this file at the **start of every phase** before writing code.

## Authority

1. [SPEC.md](../../SPEC.md) wins on behavior.
2. [docs/design/](../design/) (Claude Design export) wins on chrome/layout/visuals when SPEC is silent.
3. [docs/TECH_STACK.md](../TECH_STACK.md) wins on stack choices unless a spike proves a crate unusable; then document the swap in DECISIONS.md and continue.

## Autonomy

- Implement phases **sequentially** (01 → 14). Do not skip ahead except for tiny shared helpers required by the current phase.
- After each phase: mark it complete in the phase doc and in [index.plan.md](index.plan.md), then commit and push to `main` with conventional commits.
- Do **not** stop between phases to ask questions. Circumvent reasonable blockers inside the repo.
- Stop only for: permission denials you cannot fix, destructive ambiguity outside the repo, or a hazard that needs a human (e.g. deleting user audio on disk — which v1 must never do).

## Sandbox

- **Write** only inside this repo, `/tmp`, and OS app data/cache directories that Sift itself creates (e.g. `~/Library/Application Support/Sift`, `~/Library/Caches/Sift`).
- **Read-only** outside those paths is fine (e.g. reading `~/Projects/oss/loudline` for conventions, reading Downloads for design zips).
- Never modify or delete user audio files on disk. Metadata lives in the app DB only.
- Never force-push, never rewrite git history, never skip hooks unless hooks are broken by environment and a new commit after fix is required.

## Engineering bias

- Prefer maintained crates/packages over custom DSP/OS code.
- Rust owns decode, playback (`cpal`), index, watch, analysis, JIT, peaks. WebView owns chrome only.
- No Web Audio as the preview engine. No PCM over JSON IPC.
- Locales: all user-visible strings in `src/locales/en/…`. Themes: all colors in `src/themes/…`.
- macOS-first dogfood is enough for v1; do not block on Windows CI.

## Phase doc contract

Every `phases/NN-*.md` must include:

- Status (`pending` / `in_progress` / `complete`)
- What the previous phase delivered
- This phase's job, in scope, out of scope
- Acceptance criteria
- Rough next phase
- SPEC sections touched

## Progress tracking

Update the status table in [index.plan.md](index.plan.md) whenever a phase starts or finishes.
