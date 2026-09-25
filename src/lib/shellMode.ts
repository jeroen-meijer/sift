import type { DbStats } from "./ipc";

/** Which main chrome to paint after settings + db stats resolve. */
export type ShellMode = "boot" | "empty" | "library";

/**
 * Startup gate: unknown stats must not look like a first-run empty library.
 * Settings (`loaded`) must be in before we pick a theme-dependent view.
 */
export function shellMode(loaded: boolean, stats: DbStats | null): ShellMode {
  if (!loaded || stats === null) return "boot";
  if (stats.roots === 0) return "empty";
  return "library";
}
