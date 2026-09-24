#!/usr/bin/env bun
/**
 * Rasterize the Source-column Splice badge for visual QA.
 *
 *   bun run tool/render-splice-badge.ts
 *   bun run tool/render-splice-badge.ts --out /tmp/splice-badge.png --size 256
 *
 * Writes PNG (+ matching SVG). Re-run after tweaking `src/lib/spliceMark.ts`.
 * Prints ink margins so you can spot crop drift without opening the file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SPLICE_MARK_PATHS, SPLICE_MARK_VIEWBOX } from "../src/lib/spliceMark.ts";

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  const next = i >= 0 ? process.argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : fallback;
}

const out = resolve(arg("--out", "tmp/splice-badge.png"));
const size = Number(arg("--size", "256"));
const chip = Number(arg("--chip", String(size)));
const inset = Number(arg("--inset", "0.12")); // fraction of chip empty around the mark
const mark = Math.round(chip * (1 - inset * 2));
const pad = Math.round((chip - mark) / 2);

const paths = SPLICE_MARK_PATHS.map((d) => `    <path fill="#fff" d="${d}"/>`).join("\n");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${chip}" height="${chip}" viewBox="0 0 ${chip} ${chip}">
  <rect width="${chip}" height="${chip}" rx="${Math.max(2, Math.round(chip * 0.18))}" fill="rgba(0,0,0,0.72)"/>
  <svg x="${pad}" y="${pad}" width="${mark}" height="${mark}" viewBox="${SPLICE_MARK_VIEWBOX}">
${paths}
  </svg>
</svg>
`;

mkdirSync(dirname(out), { recursive: true });
const svgPath = out.replace(/\.png$/i, ".svg");
writeFileSync(svgPath, svg);

const rsvg = spawnSync(
  "rsvg-convert",
  ["-w", String(size), "-h", String(size), svgPath, "-o", out],
  { encoding: "utf8" },
);
if (rsvg.status !== 0) {
  console.error(rsvg.stderr || rsvg.stdout || "rsvg-convert failed");
  process.exit(rsvg.status ?? 1);
}

const margins = spawnSync(
  "magick",
  [out, "-channel", "RGB", "-separate", "-delete", "0,1", "-threshold", "10%", "-format", "%@", "info:"],
  { encoding: "utf8" },
);
let marginLine = "";
if (margins.status === 0 && margins.stdout.trim()) {
  const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(margins.stdout.trim());
  if (m) {
    const iw = Number(m[1]);
    const ih = Number(m[2]);
    const ix = Number(m[3]);
    const iy = Number(m[4]);
    const left = ix;
    const top = iy;
    const right = size - (ix + iw);
    const bottom = size - (iy + ih);
    marginLine = ` margins L${String(left)} R${String(right)} T${String(top)} B${String(bottom)} (Δh=${String(left - right)}, Δv=${String(top - bottom)})`;
  }
}

console.log(`wrote ${out} (${String(size)}×${String(size)}, viewBox=${SPLICE_MARK_VIEWBOX}, inset=${String(inset)})${marginLine}`);
console.log(`svg  ${svgPath}`);
