#!/usr/bin/env bun
/**
 * Release-mode Sift with `SIFT_PROFILE=1` timing logs.
 *
 * Usage: bun run tauri:profile
 * Log:   logs/sift-profile.log  (truncated each run; also mirrored to stderr)
 *
 * Quit the app when done; then share / open that log for analysis.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dir, "..");
const logPath = resolve(root, "logs/sift-profile.log");
mkdirSync(resolve(root, "logs"), { recursive: true });

process.env.SIFT_PROFILE = "1";
process.env.SIFT_PROFILE_LOG = logPath;

console.log(`[tauri:profile] SIFT_PROFILE=1`);
console.log(`[tauri:profile] log → ${logPath}`);
console.log(`[tauri:profile] starting tauri dev --release (first build can take a while)`);

const child = spawn("bunx", ["tauri", "dev", "--release"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.log(`[tauri:profile] exited signal=${signal}`);
    process.exit(1);
  }
  console.log(`[tauri:profile] done. inspect ${logPath}`);
  process.exit(code ?? 0);
});
