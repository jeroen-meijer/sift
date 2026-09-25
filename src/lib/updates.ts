/** App updates (GitHub Releases + latest.json). Used by Settings → About and the launch prompt. */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "error";

export interface AvailableUpdate {
  version: string;
  notes: string | null;
  /** Plugin handle passed to {@link installAvailableUpdate}. */
  update: Update;
}

export type CheckOutcome =
  | { kind: "skipped" }
  | { kind: "upToDate" }
  | { kind: "available"; available: AvailableUpdate }
  | { kind: "error"; message: string };

/** False in Vite/Tauri dev (no signed release to hit). */
export function updatesEnabled(): boolean {
  return !import.meta.env.DEV;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Compare the running app to latest.json. Dev returns `skipped`. Fetch failures return `error`. */
export async function checkForAppUpdate(): Promise<CheckOutcome> {
  if (!updatesEnabled()) return { kind: "skipped" };
  try {
    const update = await check();
    if (update == null) return { kind: "upToDate" };
    return {
      kind: "available",
      available: {
        version: update.version,
        notes: update.body ?? null,
        update,
      },
    };
  } catch (err: unknown) {
    return { kind: "error", message: errorMessage(err) };
  }
}

/** Download, install, relaunch. Confirm with the user before calling. */
export async function installAvailableUpdate(available: AvailableUpdate): Promise<void> {
  await available.update.downloadAndInstall();
  await relaunch();
}
