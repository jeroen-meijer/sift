#!/usr/bin/env bun
/**
 * Scan locale string VALUES against docs/reference/terminology.yaml.
 *
 * Hard-ban hits print path + term and exit 1.
 * Soft-ban hits warn on stderr. Exit 0 when there are no hard-bans.
 *
 *     bun tool/check-i18n.ts
 *     # or
 *     bun run i18n:check
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/** Parent of `tool/`; works even when cwd is wrong. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TERMINOLOGY = join(ROOT, "docs/reference/terminology.yaml");
const LOCALES = join(ROOT, "src/locales");

interface TermEntry {
  preferred?: string;
  note?: string;
  hard_ban?: string[];
  soft_ban?: string[];
}

interface Terminology {
  terms?: TermEntry[];
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function walkJsonFiles(absDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(abs);
      else if (name.endsWith(".json")) out.push(abs);
    }
  }
  walk(absDir);
  return out.sort();
}

/** Collect string VALUES (not keys) with a JSON-path for reporting. */
function collectValues(
  value: unknown,
  path: string,
  out: { path: string; text: string }[],
): void {
  if (typeof value === "string") {
    out.push({ path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      collectValues(item, `${path}[${String(i)}]`, out);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = path === "" ? k : `${path}.${k}`;
      collectValues(v, next, out);
    }
  }
}

function wholeWordRe(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, "i");
}

function main(): number {
  const raw = parseYaml(readFileSync(TERMINOLOGY, "utf8")) as Terminology;
  const terms = raw.terms ?? [];
  const hard: { term: string; preferred: string }[] = [];
  const soft: { term: string; preferred: string }[] = [];
  for (const entry of terms) {
    const preferred = entry.preferred ?? "?";
    for (const t of entry.hard_ban ?? []) {
      if (t) hard.push({ term: t, preferred });
    }
    for (const t of entry.soft_ban ?? []) {
      if (t) soft.push({ term: t, preferred });
    }
  }

  const hardRes = hard.map((h) => ({ ...h, re: wholeWordRe(h.term) }));
  const softRes = soft.map((s) => ({ ...s, re: wholeWordRe(s.term) }));

  const hardProblems: string[] = [];
  const softProblems: string[] = [];

  for (const abs of walkJsonFiles(LOCALES)) {
    const rel = toPosix(relative(ROOT, abs));
    const data: unknown = JSON.parse(readFileSync(abs, "utf8"));
    const values: { path: string; text: string }[] = [];
    collectValues(data, "", values);
    for (const { path, text } of values) {
      for (const h of hardRes) {
        if (h.re.test(text)) {
          hardProblems.push(
            `${rel}:${path}: hard-ban ${JSON.stringify(h.term)} (prefer ${h.preferred})`,
          );
        }
      }
      for (const s of softRes) {
        if (s.re.test(text)) {
          softProblems.push(
            `${rel}:${path}: soft-ban ${JSON.stringify(s.term)} (prefer ${s.preferred})`,
          );
        }
      }
    }
  }

  for (const p of hardProblems) console.log(p);
  for (const p of softProblems) console.error(p);

  if (hardProblems.length > 0) {
    console.log(
      `${String(hardProblems.length)} hard-ban hit(s), ${String(softProblems.length)} soft-ban warning(s)`,
    );
    return 1;
  }
  if (softProblems.length > 0) {
    console.error(
      `0 hard-ban hits, ${String(softProblems.length)} soft-ban warning(s)`,
    );
  } else {
    console.log("locales clean");
  }
  return 0;
}

process.exit(main());
