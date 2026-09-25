# Documentation

How Sift docs are laid out, named, and maintained. Agents and humans follow this file. Product behavior is in [spec.md](spec.md). Commands and tooling are in [AGENTS.md](../AGENTS.md).

## Layout

| Path | Role |
| --- | --- |
| [spec.md](spec.md) | Living product rules |
| [decisions.md](decisions.md) | Requirements Q&A history |
| [known-issues.md](known-issues.md) | Open bugs and dogfood notes |
| [reference/](reference/) | Durable how-to and facts (stack, localization, taxonomy) |
| [research/](research/) | Investigations and evidence; distill into spec/reference/decisions when settled |
| [plans/](plans/) | Historical v1 phase plan |
| [design/](design/) | Claude Design export and visual gaps |

App icon and logo sources: [`assets/brand/`](../assets/brand/README.md). Generated platform icons: `src-tauri/icons/`.

Root of the repo keeps user-facing and contributor markdown only: `README.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md`. Do not add other root markdown.

## Naming

- Under `docs/`: `kebab-case.md` (dots allowed in versioned names such as `v1.1-gaps.md`).
- Folder indexes: `README.md`.
- No YAML or TOML frontmatter. The human title is the file's `#` heading.
- Do not leave `foo-v2.md` beside `foo.md`. Replace the old file or merge into it.
- Do not leave rename redirects or copies under old names.

## When to write where

- New durable fact or how-to → update or add under `reference/`.
- New product behavior → update `spec.md` (and `decisions.md` if it was a settled Q&A).
- Investigation, profiling, competitor notes → `research/`. Distill useful conclusions into spec or reference, then leave research as evidence or delete if it has no lasting value.
- Prefer updating an existing doc over creating a parallel one.

## Single source of truth

Never duplicate lasting guidance across `AGENTS.md`, `docs/`, plans, and design notes.

Put lasting detail in one place. `AGENTS.md` and plans are pointers: they link here (or to the canonical doc) and must not restate the same rules or long samples.

If content already exists, link to it. If it is missing, add it to the canonical doc and link from the pointer. When updating, edit the source of truth and delete stale copies.

## Repo hygiene

Do not commit:

- Absolute personal paths (`/Users/…`)
- Personal sync roots (`~/Dropbox/…`, CloudStorage studio trees)
- Sibling local project paths (`~/Projects/…`)
- Private secrets-store locations
- Personal Cursor/Claude global rules pasted into this repo

Allowed:

- Portable paths such as `$HOME/...` and `~/Library/Application Support/dev.jfk.Sift/...`
- Public GitHub URLs for this project (and related public repos by the same author)
- Product talk about Dropbox / File Provider as a sync class

## Persist durable preferences

When the user states a durable preference about how this repo is documented, structured, named, sanitized, or how agents should behave here, update this file and/or [AGENTS.md](../AGENTS.md) in the same session. Do not wait to be asked to "put that in the docs".

Durable means it would still matter next week to a cold agent. One-off task tips and temporary debug notes stay out unless asked.

## Prefer clean end state

For code and docs changes, follow [Prefer clean end state](../AGENTS.md#prefer-clean-end-state) in AGENTS.md. Do not leave half-migrated trees, rename shims, or bolted-on sections.

## Lint and validate

After you edit markdown under `docs/`, root `*.md`, or `assets/**/*.md`, run:

```bash
bun run docs:check
```

That gate is also part of `bun run preflight` and CI. It runs two checks:

1. [`tool/check-docs.py`](../tool/check-docs.py): internal links and heading anchors, no YAML frontmatter under `docs/`, kebab-case filenames (see [Naming](#naming)), and path hygiene from [Repo hygiene](#repo-hygiene).
2. `markdownlint-cli2`: code-fence languages, heading and list shape. Config: [`.markdownlint-cli2.jsonc`](../.markdownlint-cli2.jsonc).

External http(s) links are a separate, optional check (needs the network, and some sites block scripted requests):

```bash
bun run docs:links
```

## Root README

[README.md](../README.md) is for producers and other people who run the app. Keep stack, lint, and release detail in AGENTS.md.
