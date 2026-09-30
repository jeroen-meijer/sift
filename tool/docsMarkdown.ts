/**
 * Shared markdown inventory for docs tooling (`check-docs`, `check-links`).
 * Repo root is the parent of `tool/` (script-relative, not cwd).
 */

import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "dist-ssr",
  "_ds",
]);

/** Parent of `tool/`; works even when cwd is wrong. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Root README plus every `.md` under `docs/` and `assets/`. */
export function listMarkdownFiles(root: string = REPO_ROOT): string[] {
  const out: string[] = [];

  function walk(absDir: string): void {
    const relDir = relative(root, absDir);
    const relPosix = relDir === "" ? "." : toPosix(relDir);

    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return;
    }

    const dirnames: string[] = [];
    const filenames: string[] = [];
    for (const name of entries) {
      let isDir = false;
      try {
        isDir = statSync(join(absDir, name)).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) dirnames.push(name);
      } else {
        filenames.push(name);
      }
    }

    if (relPosix === ".") {
      for (const name of filenames) {
        if (name.endsWith(".md")) out.push(name);
      }
      for (const d of dirnames) walk(join(absDir, d));
      return;
    }

    const underDocs = relPosix === "docs" || relPosix.startsWith("docs/");
    const underAssets = relPosix === "assets" || relPosix.startsWith("assets/");
    if (!underDocs && !underAssets) return;

    for (const name of filenames) {
      if (name.endsWith(".md")) out.push(`${relPosix}/${name}`);
    }
    for (const d of dirnames) walk(join(absDir, d));
  }

  walk(root);
  return out.sort();
}
