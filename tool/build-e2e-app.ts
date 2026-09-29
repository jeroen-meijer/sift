/**
 * Build a debug Sift binary with the `e2e` Cargo feature and WDIO capabilities.
 *
 * Usage (repo root): bun tool/build-e2e-app.ts
 */

import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();

function run(cmd: string, args: string[], label: string, env?: NodeJS.ProcessEnv): void {
  console.log(`\n→ ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

mkdirSync(join(ROOT, "tmp", "e2e-home"), { recursive: true });

run("bun", ["tool/sync-version.ts"], "sync version");
run(
  "bun",
  [
    "run",
    "tauri",
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "e2e",
    "--config",
    "src-tauri/tauri.e2e.conf.json",
  ],
  "tauri build (debug, e2e)",
  { VITE_E2E: "1" },
);

const bin =
  process.platform === "win32"
    ? "src-tauri/target/debug/Sift.exe"
    : "src-tauri/target/debug/Sift";
console.log(`\n✓ E2E binary: ${bin}`);
