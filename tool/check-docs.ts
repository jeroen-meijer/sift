#!/usr/bin/env bun
/**
 * Validate the docs contract from docs/README.md.
 *
 * Checks internal doc links and heading anchors, plus naming and path-hygiene
 * rules from docs/README.md.
 *
 * Fence, heading, and list shape live in `.markdownlint-cli2.jsonc`
 * (`bun run lint:docs`). Run both with `bun run docs:check`.
 *
 *     bun tool/check-docs.ts
 *     # or
 *     bun run docs:check
 *
 * Exit code 1 on any problem.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { REPO_ROOT, listMarkdownFiles, toPosix } from "./docsMarkdown";

const ROOT = REPO_ROOT;

/** GitHub's slugger: lowercase, drop punctuation, spaces to dashes. */
const PUNCT = /[`*[\]():/.,'\u2019\u2014\u2013→<>+&;"?!@#$%^{}=\\|~]/g;
const EMOJI =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F1E0}-\u{1F1FF}]+/gu;

/** Paths that must not appear in committed docs (see docs/README.md hygiene). */
const FORBIDDEN_PATH =
  /(?:\/Users\/\S+|~\/Dropbox\/|~\/Library\/CloudStorage\/|~\/Projects\/)/;

const KEBAB = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.md$/;

function slug(heading: string): string {
  return heading
    .replace(EMOJI, "")
    .trim()
    .toLowerCase()
    .replace(PUNCT, "")
    .replaceAll(" ", "-");
}

function anchors(absPath: string): Set<string> {
  const found = new Set<string>();
  let inFence = false;
  for (const line of readFileSync(absPath, "utf8").split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#+\s+(.*)/.exec(line);
    if (m?.[1] !== undefined) found.add(slug(m[1]));
  }
  return found;
}

function checkLinks(files: string[], problems: string[]): void {
  const cache = new Map<string, Set<string>>();
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      let href = m[1];
      if (href === undefined) continue;
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("mailto:") ||
        href.startsWith("data:")
      ) {
        continue;
      }
      // Strip optional title: path "title"
      const first = href.split(/\s+/)[0];
      if (first === undefined) continue;
      href = first.replaceAll('"', "");
      const hashIdx = href.indexOf("#");
      const pathPart = hashIdx === -1 ? href : href.slice(0, hashIdx);
      const frag = hashIdx === -1 ? "" : href.slice(hashIdx + 1);

      let target: string;
      if (pathPart) {
        target = toPosix(normalize(join(dirname(rel) || ".", pathPart)));
        if (!existsSync(join(ROOT, target))) {
          problems.push(`${rel}: link to missing file ${href}`);
          continue;
        }
      } else {
        target = rel;
      }
      if (!frag) continue;
      if (!target.endsWith(".md") && !target.endsWith(".mdx")) continue;
      let set = cache.get(target);
      if (!set) {
        set = anchors(join(ROOT, target));
        cache.set(target, set);
      }
      if (!set.has(frag)) {
        problems.push(`${rel}: link to missing anchor ${href}`);
      }
    }
  }
}

function checkNaming(files: string[], problems: string[]): void {
  for (const rel of files) {
    if (!rel.startsWith("docs/")) continue;
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (name === "README.md") continue;
    if (!KEBAB.test(name)) {
      problems.push(
        `${rel}: docs filename must be kebab-case.md (got ${JSON.stringify(name)})`,
      );
    }
  }
}

function checkNoFrontmatter(files: string[], problems: string[]): void {
  for (const rel of files) {
    if (!rel.startsWith("docs/")) continue;
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (text.startsWith("---\n")) {
      problems.push(`${rel}: YAML frontmatter is forbidden under docs/`);
    }
  }
}

function checkHygiene(files: string[], problems: string[]): void {
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    let inFence = false;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const stripped = line.replace(/`[^`]*`/g, "");
      if (FORBIDDEN_PATH.test(stripped)) {
        problems.push(
          `${rel}:${String(i + 1)}: forbidden personal/local path (see docs/README.md hygiene)`,
        );
      }
    }
  }
}

function main(): number {
  const files = listMarkdownFiles(ROOT);
  const problems: string[] = [];
  checkLinks(files, problems);
  checkNaming(files, problems);
  checkNoFrontmatter(files, problems);
  checkHygiene(files, problems);

  for (const p of problems) console.log(p);
  console.log(
    `${String(files.length)} files checked, ${String(problems.length)} problems`,
  );
  return problems.length > 0 ? 1 : 0;
}

process.exit(main());
