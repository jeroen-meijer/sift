import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_SERVER_URL, repoRoot } from "./helpers/mockBoot.js";

const e2eRoot = dirname(fileURLToPath(import.meta.url));

let viteProc: ChildProcess | undefined;

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Vite not ready at ${url}: ${String(lastErr)}`);
}

/**
 * Renderer E2E: Chrome + Vite, Tauri `invoke` mocked by @wdio/tauri-service.
 * No Rust binary. See docs/reference/testing.md.
 */
export const config: WebdriverIO.Config = {
  runner: "local",
  // Keep driver downloads out of the OS temp dir (corrupt empty folders break retries).
  cacheDir: join(repoRoot, "tmp", "wdio-cache"),
  specs: [join(e2eRoot, "specs/browser/**/*.ts")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: [
          "--headless=new",
          "--window-size=1440,900",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ],
      },
      "wdio:tauriServiceOptions": {
        mode: "browser",
        devServerUrl: DEV_SERVER_URL,
      },
    },
  ],
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  services: [
    [
      "@wdio/tauri-service",
      {
        mode: "browser",
        devServerUrl: DEV_SERVER_URL,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  async onPrepare() {
    const reuse = !process.env.CI;
    if (reuse) {
      try {
        const res = await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(1000) });
        if (res.ok || res.status === 404) return;
      } catch {
        /* spawn below */
      }
    }
    viteProc = spawn("bun", ["run", "dev"], {
      cwd: repoRoot,
      stdio: "ignore",
      env: process.env,
      detached: false,
    });
    await waitForUrl(DEV_SERVER_URL, process.env.CI ? 120_000 : 60_000);
  },
  async onComplete() {
    if (!viteProc?.pid) return;
    viteProc.kill("SIGTERM");
    viteProc = undefined;
  },
};
