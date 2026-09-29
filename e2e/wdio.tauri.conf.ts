import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TauriCapabilities } from "@wdio/tauri-service";
import {
  assertE2eBinaryExists,
  e2eAppBinary,
  repoRoot,
} from "./helpers/mockBoot.js";

assertE2eBinaryExists();

const e2eRoot = dirname(fileURLToPath(import.meta.url));
const application = e2eAppBinary();

const tauriCapability = {
  browserName: "tauri",
  "tauri:options": {
    application,
  },
  "wdio:tauriServiceOptions": {
    mode: "native",
    driverProvider: "embedded",
    appBinaryPath: application,
  },
} as TauriCapabilities;

/**
 * Native E2E: debug Sift built with `--features e2e` (embedded WebDriver).
 * See docs/reference/testing.md.
 */
export const config: WebdriverIO.Config = {
  runner: "local",
  cacheDir: join(repoRoot, "tmp", "wdio-cache"),
  specs: [join(e2eRoot, "specs/tauri/**/*.ts")],
  maxInstances: 1,
  capabilities: [tauriCapability],
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  services: [
    [
      "@wdio/tauri-service",
      {
        mode: "native",
        driverProvider: "embedded",
        appBinaryPath: application,
        // Prefer a throwaway profile so tests do not touch the developer DB.
        // Sift uses directories; HOME override is enough on macOS.
        processEnv: {
          ...process.env,
          HOME: process.env.SIFT_E2E_HOME ?? `${repoRoot}/tmp/e2e-home`,
        },
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
};
