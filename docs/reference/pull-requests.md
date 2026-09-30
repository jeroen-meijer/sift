# Commits and pull requests

How to title commits and pull requests in this repo. Agents and humans follow this file. Product release notes live in [CHANGELOG.md](../../CHANGELOG.md) → `## Upcoming` (see [AGENTS.md](../../AGENTS.md#changelog--release)).

## Title shape (commits and PRs)

Same Conventional Commits form for both:

```text
<type>(optional-scope): <imperative summary>
```

- Lowercase after the colon. No trailing period.
- Imperative verb: add, fix, remove. Not added or adds.
- Add a scope when it helps (see [Scopes](#scopes)).
- Breaking change: `feat(library)!: ...` or a `BREAKING CHANGE:` footer.
- One line. Say what changed. Skip sales language.

## Types

Prefer these (commitizen / semantic PR style). Do not use `build`. `release` is for PR titles only, not commits:

| Type | Use for | Commits | PRs |
| --- | --- | --- | --- |
| `feat` | New feature | yes | yes |
| `fix` | Bug fix | yes | yes |
| `docs` | Docs only | yes | yes |
| `style` | Formatting or whitespace only | yes | yes |
| `refactor` | Neither fix nor feature | yes | yes |
| `perf` | Performance | yes | yes |
| `test` | Tests | yes | yes |
| `ci` | CI config or scripts | yes | yes |
| `chore` | Tooling, deps, back-merges, other non-src/test | yes | yes |
| `revert` | Revert a prior commit | yes | yes |
| `release` | Release or hotfix into `main` | no | yes |

Examples: `feat(ui): make Graphite the default theme`, `fix(library): keep tags when folders move outside Sift`, `feat(ci): ship Intel Mac builds alongside Apple Silicon`, `chore: back-merge release 0.5.0`, `release(app): 0.6.0`.

Commit body only when it helps (why or caveats). Short paragraph or bullets.

## Scopes

Optional. Use when one area clearly owns the change. Common scopes in this repo:

| Scope | Area |
| --- | --- |
| `ui` | Chrome, themes, dialogs, menus, toasts, transport chrome |
| `library` | Sample library, folders, index, watch, undo of sample metadata |
| `audio` | Playback, convert, devices |
| `wave` | Waveforms and peakfiles |
| `analyze` | Analysis queue, BPM/key/type detection |
| `search` | Omni search and filters |
| `detail` | Detail pane |
| `sidebar` | Folder sidebar |
| `table` | Sample table / columns |
| `settings` | Preferences |
| `app` | App shell, updates, installers, icons |
| `macos` / `windows` | Platform-specific |
| `i18n` | Locales and terminology |
| `docs` | Documentation |
| `ci` | GitHub Actions and release tooling |

Skip the scope when the change spans several areas and no single one fits (`fix: harden library integrity, playback, and UI`).

## Pull request body

Use the GitHub PR template (`.github/pull_request_template.md`). Shape:

```markdown
## Description

This PR <one clear sentence starting with "This PR">.

### Changes

- <concrete change>
- <concrete change>

### Notes

<Only when reviewers need extra context. Omit the heading when empty.>
```

Rules:

1. Open `## Description` with one or two sentences that start with `This PR`.
2. `### Changes`: verb-first bullets (Add, Fix, Remove, Update, Move). One change per line. State what changed, not why.
3. Do not add a Test plan section unless the author asked for one.
4. `### Notes` only for risks, follow-ups, intentional omissions, or merge caveats. Drop the section when empty.
5. End with a standalone `Closes #N` line when there is a GitHub issue. No punctuation on that line. Omit it when there is no ticket.
6. No AI-tool credit ("Made with Cursor", "Generated with …", or similar) in the title, body, commits, or comments.
7. Run `/humanize` (or match that skill) on the title and body before you open or update the PR.

## Before you open

1. `bun run preflight` when Rust, frontend, docs, or CI-related files changed (same gates as CI on this machine).
2. Update `CHANGELOG.md` → `## Upcoming` for user-visible work. CI checks that Upcoming changed vs the PR base (`tool/check_changelog_pr.sh`). You may rewrite, merge, or drop unshipped Upcoming bullets. Do not leave Upcoming identical to the base.
3. Prefer one clear change per PR when practical.

## Voice

Plain and dry. Lead with what the PR does. No em dashes. No "it's not X, it's Y". No hype words (robust, seamless, comprehensive, leverage, and similar). Concrete nouns. Active voice.
