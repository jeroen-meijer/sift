/** Path helpers for the folder sidebar and folder omni chip. */

/** Normalize separators so macOS/Windows paths compare equal. */
export function normFolderPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function folderPathsEqual(a: string, b: string): boolean {
  return normFolderPath(a) === normFolderPath(b);
}

/** Active folder filter in the sidebar (path plus a reveal counter). */
export interface FolderSelection {
  path: string;
  /** Bump to expand/scroll again when the path did not change (for example Show parent). */
  reveal: number;
}

/** Ancestors that must be expanded so `path` shows in the one-level-collapse tree. Closest parent first. */
export function ancestorPathsToExpand(
  path: string,
  folderPaths: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const p = normFolderPath(path);
  let slash = p.lastIndexOf("/");
  while (slash > 0) {
    const parent = p.slice(0, slash);
    if (folderPaths.has(parent)) out.push(parent);
    slash = parent.lastIndexOf("/");
  }
  return out;
}

/** Index of `path` in a flat folder list, or -1. */
export function findFolderIndex(
  folders: readonly { path: string }[],
  path: string,
): number {
  return folders.findIndex((n) => folderPathsEqual(n.path, path));
}
