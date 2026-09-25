/**
 * Create or update the GitHub release from staged assets and attach latest.json
 * for tauri-plugin-updater.
 *
 * Usage (repo root, GITHUB_TOKEN set):
 *   bun tool/finish_github_release.ts --version 0.4.0 --sha <commit> --assets-dir release-assets
 *
 * latest.json points at versioned macOS *.app.tar.gz and Windows NSIS *-setup.exe.
 * MSI and stable hand-install aliases (e.g. Sift_macOS_aarch64.dmg,
 * Sift_Windows_x64-setup.exe) stay on the release for README
 * /releases/latest/download/ links only.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = process.cwd();

interface PlatformEntry {
  signature: string;
  url: string;
}

interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, PlatformEntry>;
}

function usage(): never {
  console.error(
    "usage: bun tool/finish_github_release.ts --version x.y.z --sha <commit> --assets-dir <dir>",
  );
  process.exit(2);
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function gh(args: string[], opts?: { input?: string }): void {
  const r = spawnSync("gh", args, {
    cwd: ROOT,
    stdio: opts?.input != null ? ["pipe", "inherit", "inherit"] : "inherit",
    input: opts?.input,
    env: process.env,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function ghCapture(args: string[]): string {
  const r = spawnSync("gh", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || "gh failed");
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

function downloadUrl(ownerRepo: string, version: string, fileName: string): string {
  return `https://github.com/${ownerRepo}/releases/download/${version}/${fileName}`;
}

/** True when the filename still carries Tauri's _x.y.z_ segment. */
function hasSemverInName(fileName: string): boolean {
  return /_\d+\.\d+\.\d+_/.test(fileName) || /_\d+\.\d+\.\d+\./.test(fileName);
}

/** Tauri platform key(s) for an updater bundle, or [] for hand-install-only files. */
function platformKeysForAsset(fileName: string): string[] {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".app.tar.gz")) {
    if (lower.includes("aarch64") || lower.includes("arm64")) return ["darwin-aarch64"];
    if (lower.includes("x86_64") || lower.includes("x64")) return ["darwin-x86_64"];
    // Unmarked .app.tar.gz: GitHub macos-latest is Apple Silicon.
    return ["darwin-aarch64"];
  }

  // NSIS setup for the updater. MSI and stable aliases are hand-install only.
  if (lower.endsWith("-setup.exe")) {
    if (lower.includes("aarch64") || lower.includes("arm64")) return ["windows-aarch64"];
    if (lower.includes("i686") || lower.includes("_x86.") || /[^a-z]x86-/.test(lower)) {
      return ["windows-i686"];
    }
    return ["windows-x86_64"];
  }

  return [];
}

function isUpdaterBundle(fileName: string): boolean {
  if (platformKeysForAsset(fileName).length === 0) return false;
  // .app.tar.gz is updater-only (never a stable README alias).
  if (fileName.toLowerCase().endsWith(".app.tar.gz")) return true;
  // Stable Sift_Windows_*-setup.exe has no .sig; only the versioned NSIS updates.
  return hasSemverInName(fileName);
}

function main(): void {
  const version = argValue("--version");
  const sha = argValue("--sha");
  const assetsDirArg = argValue("--assets-dir");
  if (!version || !sha || !assetsDirArg) usage();

  const assetsDir = resolve(ROOT, assetsDirArg);
  const files = readdirSync(assetsDir).filter((name) => !name.startsWith("."));
  if (files.length === 0) {
    console.error(`error: no files in ${assetsDir}`);
    process.exit(1);
  }

  const ownerRepo = ghCapture([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]).trim();

  const platforms: Record<string, PlatformEntry> = {};

  for (const fileName of files) {
    if (!isUpdaterBundle(fileName)) continue;
    const sigName = `${fileName}.sig`;
    if (!files.includes(sigName)) {
      console.error(`error: missing signature for updater bundle: ${sigName}`);
      process.exit(1);
    }
    const signature = readFileSync(join(assetsDir, sigName), "utf8").trim();
    const url = downloadUrl(ownerRepo, version, fileName);
    for (const key of platformKeysForAsset(fileName)) {
      platforms[key] = { signature, url };
    }
  }

  if (Object.keys(platforms).length === 0) {
    console.error("error: no updater platforms found (need .app.tar.gz / NSIS .exe + .sig)");
    process.exit(1);
  }

  const notes = `Sift ${version}`;
  const latest: LatestJson = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  };

  const latestPath = join(assetsDir, "latest.json");
  writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${latestPath}`);
  console.log(`Platforms: ${Object.keys(platforms).sort().join(", ")}`);

  const existing = spawnSync("gh", ["release", "view", version], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });

  const assetPaths = files
    .filter((name) => name !== "latest.json")
    .map((name) => join(assetsDir, name));
  assetPaths.push(latestPath);

  if (existing.status === 0) {
    console.log(`Release ${version} exists; uploading assets`);
    gh(["release", "upload", version, ...assetPaths, "--clobber"]);
  } else {
    console.log(`Creating release ${version}`);
    gh([
      "release",
      "create",
      version,
      "--target",
      sha,
      "--title",
      version,
      "--generate-notes",
      ...assetPaths,
    ]);
  }

  console.log(`Release ${version} ready (${basename(latestPath)} + ${files.length} staged files)`);
}

main();
