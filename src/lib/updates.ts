/** App updates (GitHub Releases + latest.json). Used by Settings → About and the launch prompt. */

import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'error';

export interface AvailableUpdate {
  version: string;
  notes: string | null;
  /** Download, install, relaunch (or throw). Confirm with the user before calling. */
  install: () => Promise<void>;
}

export type CheckOutcome =
  | { kind: 'skipped' }
  | { kind: 'upToDate' }
  | { kind: 'available'; available: AvailableUpdate }
  | { kind: 'error'; message: string };

/** False in Vite/Tauri dev (no signed release to hit). */
export function updatesEnabled(): boolean {
  return !import.meta.env.DEV;
}

/**
 * Dev-only: open with `?previewUpdate` to show the launch update dialog
 * without a real release.
 */
export function previewAvailableUpdate(): AvailableUpdate | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === 'undefined') return null;
  if (!new URLSearchParams(window.location.search).has('previewUpdate')) return null;
  return {
    version: '9.9.9',
    notes: 'Preview only. Install is disabled in this mode.',
    install: () => {
      throw new Error('Preview only; install is disabled.');
    },
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Compare the running app to latest.json. Dev returns `skipped`. Fetch failures return `error`. */
export async function checkForAppUpdate(): Promise<CheckOutcome> {
  if (!updatesEnabled()) return { kind: 'skipped' };
  try {
    const update = await check();
    if (update == null) return { kind: 'upToDate' };
    return {
      kind: 'available',
      available: {
        version: update.version,
        notes: update.body ?? null,
        install: async () => {
          await update.downloadAndInstall();
          await relaunch();
        },
      },
    };
  } catch (err: unknown) {
    return { kind: 'error', message: errorMessage(err) };
  }
}

/** Run {@link AvailableUpdate.install}. Confirm with the user before calling. */
export async function installAvailableUpdate(available: AvailableUpdate): Promise<void> {
  await available.install();
}
