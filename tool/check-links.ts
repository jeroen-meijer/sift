#!/usr/bin/env bun
/**
 * Check that external http(s) links in the docs resolve.
 *
 * `tool/check-docs.ts` covers internal links and anchors on every edit. This
 * script is the external counterpart. Run it by hand: it needs the network and
 * is slow. It is not part of `bun run docs:check`. A flaky site or temporary
 * timeout should not block an unrelated doc edit.
 *
 *     bun tool/check-links.ts
 *     # or
 *     bun run docs:links
 *
 * Exit code 1 if any link comes back broken.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, listMarkdownFiles } from "./docsMarkdown";

const ROOT = REPO_ROOT;
const TIMEOUT_MS = 10_000;
const UA =
  "Mozilla/5.0 (compatible; sift-check-links; +local docs link check)";

function findLinks(files: string[]): Map<string, string[]> {
  const linkRe =
    /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g;
  const links = new Map<string, string[]>();
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const m of text.matchAll(linkRe)) {
      const raw = m[1] ?? m[2];
      if (raw === undefined) continue;
      const url = raw.replace(/[.,;]+$/, "");
      const where = links.get(url);
      if (where) where.push(rel);
      else links.set(url, [rel]);
    }
  }
  return links;
}

async function check(
  url: string,
): Promise<{ status: number | null; err: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);
  try {
    let resp = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      signal: controller.signal,
      redirect: "follow",
    });
    if (resp.status === 405 || resp.status === 403) {
      resp = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA },
        signal: controller.signal,
        redirect: "follow",
      });
    }
    return { status: resp.status, err: null };
  } catch (e) {
    return { status: null, err: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<number> {
  const files = listMarkdownFiles(ROOT);
  const links = findLinks(files);
  console.log(
    `Checking ${String(links.size)} external links across ${String(files.length)} files...`,
  );

  const problems: string[] = [];
  const urls = [...links.keys()];
  const concurrency = 8;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < urls.length) {
      const i = next;
      next += 1;
      const url = urls[i];
      if (url === undefined) continue;
      const { status, err } = await check(url);
      if (status === null || status >= 400) {
        const where = (links.get(url) ?? []).join(", ");
        problems.push(`${url} (${where}): ${err ?? String(status)}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () =>
      worker(),
    ),
  );

  for (const p of problems.sort()) console.log(p);
  console.log(
    `${String(links.size)} links checked, ${String(problems.length)} problems`,
  );
  return problems.length > 0 ? 1 : 0;
}

process.exit(await main());
