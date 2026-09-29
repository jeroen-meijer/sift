# E2E testing for Tauri apps (research)

How to drive Sift's real UI for feature checks, including agent-driven ones. Settled how-to: [testing.md](../reference/testing.md). Last researched: 2026-09-29.

## Question

What is the usual, well-documented way to E2E-test a Rust Tauri 2 desktop app on macOS and Windows, matching Tauri's docs and what larger public Tauri apps use?

## Options considered

| Approach | Platforms for real webview | Status |
| --- | --- | --- |
| WebdriverIO + `@wdio/tauri-service` (embedded provider) | macOS, Windows, Linux | Official Tauri recommendation |
| Raw `tauri-driver` + Selenium / WDIO | Windows, Linux only | Official low-level path. No WKWebView driver on macOS |
| CrabNebula `@crabnebula/tauri-driver` | All three (macOS needs a paid API key) | Commercial fork. Optional later |
| Playwright against the Tauri webview | Windows CDP only natively. macOS/Linux need community bridges | Usual for web apps. Not for Tauri desktop |
| Community `tauri-plugin-playwright` / socket bridges | Claimed all platforms | Small ecosystem. Not what Tauri docs point to |
| Vite + Chrome only (mocked `invoke`) | N/A (not the real shell) | Fast renderer checks. Not full E2E |

## Why not Playwright as the default

Tauri uses system webviews (WKWebView, WebView2, WebKitGTK), not Chromium. Playwright expects Chrome DevTools Protocol. Only WebView2 exposes CDP cleanly. Standard Playwright cannot drive a real Sift window on macOS. Community bridges exist. They are not the documented Tauri path.

## What Tauri documents (v2, updated 2026-06)

From [Tests](https://v2.tauri.app/develop/tests/) and [WebDriver](https://v2.tauri.app/develop/tests/webdriver/):

1. Unit / integration: Rust mock runtime plus usual frontend unit tests.
2. E2E: WebDriver protocol.
3. Recommended client: WebdriverIO with `@wdio/tauri-service`.
4. Default driver provider: `embedded` via `tauri-plugin-wdio-webdriver` (this is how macOS works without CrabNebula).
5. Optional: `tauri-plugin-wdio` for `browser.tauri.execute()`, IPC mocking, and log capture.
6. Fast renderer-only path: WDIO browser mode (Chrome + Vite, mock `invoke`).

Scaffold: `npm create wdio@latest ./` → Desktop Testing → Tauri.

## What larger public repos use

Search (2026-09) shows `@wdio/tauri-service` in:

- [janhq/jan](https://github.com/janhq/jan): dedicated `e2e/` package, Cargo feature `e2e` → `tauri-plugin-wdio-webdriver`, debug binary, WDIO specs
- [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)
- Smaller apps (Open Pencil, UniClipboard)
- Official fixture: [webdriverio/desktop-mobile](https://github.com/webdriverio/desktop-mobile/tree/main/fixtures/e2e-apps/tauri)

`@wdio/tauri-service` is maintained under the WebdriverIO desktop-mobile project (v1.4.x as of 2026-09).

## Recommended pyramid for Sift

1. Vitest (+ Testing Library): parsers and chips, plus small component checks. Already in CI via `bun run test`.
2. WDIO browser mode: omni bar and shell UI against Vite with mocked IPC. Fast. Good for agent iteration.
3. WDIO native / embedded: debug binary built with Cargo feature `e2e`. Real webview and real Rust. Smoke on macOS (and later Windows). Not required on every PR until stable.

Do not enable the `e2e` feature on release builds. The embedded WebDriver server is a remote-control surface.

## Rejected for v1 scaffolding

- CrabNebula paid macOS driver (optional later if embedded is not enough)
- Playwright as the primary desktop harness
- Agent MCP computer use as a stand-in for a CI suite (fine for interactive poking, not the release gate)

## Sources

- <https://v2.tauri.app/develop/tests/>
- <https://v2.tauri.app/develop/tests/webdriver/>
- <https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-service>
- <https://github.com/janhq/jan/tree/main/e2e>
