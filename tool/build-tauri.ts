/**
 * Production Tauri desktop build.
 *
 * 1. Sync version from package.json → Tauri metadata
 * 2. Lint
 * 3. tauri build
 *
 * Usage:
 *   bun tool/build-tauri.ts
 */

import { spawnSync } from "node:child_process";

/** Always invoked from the repo root (`bun tool/…` / package scripts). */
const ROOT = process.cwd();

function run(cmd: string, args: string[], label: string): void {
  console.log(`\n→ ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

run("bun", ["tool/sync-version.ts"], "sync version");
run("bun", ["run", "lint"], "lint");
run("bun", ["run", "tauri", "build"], "tauri build");

console.log("\n✓ Desktop bundle ready under src-tauri/target/release/bundle/");
