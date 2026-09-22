/**
 * Keep app version in one place: package.json (canonical).
 * Propagates to Tauri bundle metadata (tauri.conf.json + Cargo.toml).
 *
 * Usage:
 *   bun tool/sync-version.ts           # read version from package.json → sync Tauri
 *   bun tool/sync-version.ts 0.2.0     # set package.json to 0.2.0 → sync Tauri
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(ROOT, "package.json");
const TAURI_CONF_PATH = join(ROOT, "src-tauri/tauri.conf.json");
const CARGO_PATH = join(ROOT, "src-tauri/Cargo.toml");

const SEMVER = /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;

function readPkg(): { version: string } & Record<string, unknown> {
  return JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version: string } & Record<string, unknown>;
}

function writePkg(pkg: Record<string, unknown>) {
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

function syncTauri(version: string) {
  const conf = JSON.parse(readFileSync(TAURI_CONF_PATH, "utf8")) as { version: string };
  conf.version = version;
  writeFileSync(TAURI_CONF_PATH, `${JSON.stringify(conf, null, 2)}\n`);

  let cargo = readFileSync(CARGO_PATH, "utf8");
  if (!/^version = "/m.test(cargo)) {
    throw new Error("Could not find [package] version in src-tauri/Cargo.toml");
  }
  cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
  writeFileSync(CARGO_PATH, cargo);
}

const arg = process.argv[2];
let version: string;

if (arg) {
  if (!SEMVER.test(arg)) {
    console.error(`Invalid semver: ${arg}`);
    process.exit(1);
  }
  const pkg = readPkg();
  pkg.version = arg;
  writePkg(pkg);
  version = arg;
  console.log(`Set package.json version → ${version}`);
} else {
  version = readPkg().version;
  if (!SEMVER.test(version)) {
    console.error(`package.json version is not semver: ${version}`);
    process.exit(1);
  }
}

syncTauri(version);
console.log(`Synced Tauri metadata (tauri.conf.json, Cargo.toml) → ${version}`);
