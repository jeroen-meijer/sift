import type { DbStats } from "./ipc";

/** Main view after settings and db stats are known. */
export type ShellMode = "boot" | "empty" | "library";

/**
 * Pick the shell before painting FirstLaunch or the library.
 * Unknown stats must not look like an empty library. Theme needs `loaded`.
 */
export function shellMode(loaded: boolean, stats: DbStats | null): ShellMode {
  if (!loaded || stats === null) return "boot";
  if (stats.roots === 0) return "empty";
  return "library";
}
