/**
 * Shared WDIO helpers for Sift e2e.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root (parent of `e2e/`). */
export const repoRoot = resolve(here, "..", "..");

/** Vite / Tauri default frontend URL. */
export const DEV_SERVER_URL = "http://localhost:1420";

/**
 * Debug binary from `bun run build:e2e:app`.
 * Product name is `Sift` (see `src-tauri/tauri.conf.json`).
 */
export function e2eAppBinary(): string {
  const name = process.platform === "win32" ? "Sift.exe" : "Sift";
  return join(repoRoot, "src-tauri", "target", "debug", name);
}

export function assertE2eBinaryExists(): void {
  const path = e2eAppBinary();
  if (!existsSync(path)) {
    throw new Error(
      `No e2e app binary at ${path}. Run \`bun run build:e2e:app\` from the repo root first.`,
    );
  }
}

/** Empty library cold-start: first-run shell, no roots. */
export const EMPTY_DB_STATS = {
  roots: 0,
  samples: 0,
  missing: 0,
  tags: 0,
  data_dir: "",
  clips_dir: "",
  clips_bytes: 0,
};

/**
 * Mock the invoke commands App hits before leaving boot.
 * Call after the session is up and before (or right after) the first navigation
 * that loads the app; re-apply after `browser.url()` if needed.
 */
export async function mockEmptyLibraryBoot(): Promise<void> {
  const getSettings = await browser.tauri.mock("get_settings");
  await getSettings.mockResolvedValue({});

  const dbStats = await browser.tauri.mock("db_stats");
  await dbStats.mockResolvedValue(EMPTY_DB_STATS);

  const folderTree = await browser.tauri.mock("folder_tree");
  await folderTree.mockResolvedValue([]);

  const listTags = await browser.tauri.mock("list_tags");
  await listTags.mockResolvedValue([]);

  const listDevices = await browser.tauri.mock("list_output_devices");
  await listDevices.mockResolvedValue([]);

  const profileBatch = await browser.tauri.mock("profile_mark_batch");
  await profileBatch.mockResolvedValue(null);

  const listSamples = await browser.tauri.mock("list_samples");
  await listSamples.mockResolvedValue([]);
}
