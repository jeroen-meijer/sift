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

type Replacement = string | string[];

interface TermEntry {
  name?: string;
  description?: string;
  replacement?: Replacement;
  hard_ban?: string[];
  soft_ban?: string[];
}

interface Terminology {
  terms?: TermEntry[];
}

interface BanRule {
  term: string;
  name: string;
  replacement: string[] | undefined;
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

function normalizeReplacement(
  replacement: Replacement | undefined,
): string[] | undefined {
  if (replacement === undefined) return undefined;
  const list = Array.isArray(replacement) ? replacement : [replacement];
  const cleaned = list.map((s) => s.trim()).filter((s) => s.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Hint for ban reports: prefer …, or rule name when there is no replacement. */
export function banHint(rule: {
  name: string;
  replacement: string[] | undefined;
}): string {
  if (rule.replacement && rule.replacement.length > 0) {
    return `prefer ${rule.replacement.join(" | ")}`;
  }
  return `rule: ${rule.name}`;
}

function loadBanRules(terms: TermEntry[]): {
  hard: BanRule[];
  soft: BanRule[];
} {
  const hard: BanRule[] = [];
  const soft: BanRule[] = [];
  for (const entry of terms) {
    const name = entry.name?.trim();
    if (!name) {
      throw new Error(
        "terminology.yaml: each term needs a non-empty `name`",
      );
    }
    const replacement = normalizeReplacement(entry.replacement);
    for (const t of entry.hard_ban ?? []) {
      if (t) hard.push({ term: t, name, replacement });
    }
    for (const t of entry.soft_ban ?? []) {
      if (t) soft.push({ term: t, name, replacement });
    }
  }
  return { hard, soft };
}

function main(): number {
  const raw = parseYaml(readFileSync(TERMINOLOGY, "utf8")) as Terminology;
  const { hard, soft } = loadBanRules(raw.terms ?? []);

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
            `${rel}:${path}: hard-ban ${JSON.stringify(h.term)} (${banHint(h)})`,
          );
        }
      }
      for (const s of softRes) {
        if (s.re.test(text)) {
          softProblems.push(
            `${rel}:${path}: soft-ban ${JSON.stringify(s.term)} (${banHint(s)})`,
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

if (import.meta.main) {
  process.exit(main());
}
