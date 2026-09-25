# Contributing

Bug reports, product ideas, and pull requests are welcome. I maintain this alone in spare time, so replies and reviews can be slow. Opening a PR does not mean it will merge.

By contributing, you agree your contributions are licensed under MIT (see [LICENSE](LICENSE)).

## Issues

Search open and closed issues first.

For bugs, include steps to reproduce, OS (macOS or Windows), Sift version or commit, and what you expected versus what happened. A screenshot or short video helps for UI bugs.

For ideas, say what you want to do in the app and why. Product feedback is more useful here than architecture write-ups.

Skip commentary on how the code was written, including with AI. Bugs and ideas that make Sift better are welcome.

## Pull requests

Bug fixes, changes that fit the product, and docs that help users or contributors are welcome.

- Keep each PR to one clear change.
- Say what you changed and how you checked it (manual steps, `bun run preflight`, or targeted tests).
- Match the style already in the repo. When you extend something, leave it looking like one design, not a bolt-on.

I may decline style-only PRs, speculative refactors, or work outside product scope.

### AI-assisted contributions

I use AI agents a lot on this project. Agent-assisted PRs are fine.

The change should help Sift. Describe it clearly and say how you verified it. I will not ask you to prove you understand every line. Drive-by "cleanup" PRs or commentary on agent-written code are not useful.

## Getting started

You need Bun, Rust nightly (`src-tauri/rust-toolchain.toml`), and on macOS the Xcode Command Line Tools.

```bash
bun install
bun run tauri:dev
```

Add a sample folder in the app, then browse and play.

Before you push or open a PR:

```bash
bun run preflight
```

That runs the same checks as CI here: Rust fmt, clippy, nextest, ESLint, `tsc`, Vitest, and docs checks (`bun run docs:check`).

More detail for agents and maintainers: [AGENTS.md](AGENTS.md). Docs map: [docs/README.md](docs/README.md). Product behavior: [docs/spec.md](docs/spec.md).

## Security

Do not file public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).
