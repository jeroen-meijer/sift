#!/usr/bin/env python3
"""Validate the docs contract from docs/README.md.

Cross-links carry facts that live in one place. A dead link loses that fact.
This checks internal links and heading anchors, plus naming and path-hygiene
rules from docs/README.md.

Fence, heading, and list shape live in `.markdownlint-cli2.jsonc`
(`bun run lint:docs`). Run both with `bun run docs:check`.

    ./tool/check-docs.py
    # or
    bun run docs:check

Exit code 1 on any problem.
"""

from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# GitHub's slugger: lowercase, drop punctuation, spaces to dashes. Runs of
# dashes stay (example: "Docker CE + Compose" -> "docker-ce--compose").
PUNCT = re.compile(r"[`*\[\]():/.,'\u2019\u2014\u2013→<>+&;\"?!@#$%^{}=\\|~]")
EMOJI = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U00002600-\U000027BF"
    "\U0001F1E0-\U0001F1FF"
    "]+",
    flags=re.UNICODE,
)

# Paths that must not appear in committed docs (see docs/README.md hygiene).
FORBIDDEN_PATH = re.compile(
    r"(?:/Users/\S+"
    r"|~/Dropbox/"
    r"|~/Library/CloudStorage/"
    r"|~/Projects/)"
)

KEBAB = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)*\.md$")


def slug(heading: str) -> str:
    text = EMOJI.sub("", heading)
    return PUNCT.sub("", text.strip().lower()).replace(" ", "-")


def anchors(path: str) -> set[str]:
    found: set[str] = set()
    in_fence = False
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            m = re.match(r"^#+\s+(.*)", line)
            if m:
                found.add(slug(m.group(1)))
    return found


def markdown_files() -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        # Skip build / vendor / VCS trees.
        dirnames[:] = [
            d
            for d in dirnames
            if d
            not in {
                ".git",
                "node_modules",
                "target",
                "dist",
                "dist-ssr",
                "_ds",
            }
            and not d.startswith(".")
        ]
        if rel_dir == ".":
            for name in filenames:
                if name.endswith(".md"):
                    out.append(name)
            continue
        if not (
            rel_dir == "docs"
            or rel_dir.startswith("docs" + os.sep)
            or rel_dir == "assets"
            or rel_dir.startswith("assets" + os.sep)
        ):
            continue
        for name in filenames:
            if name.endswith(".md"):
                out.append(os.path.join(rel_dir, name).replace("\\", "/"))
    return sorted(out)


def check_links(files: list[str], problems: list[str]) -> None:
    cache: dict[str, set[str]] = {}
    for rel in files:
        text = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        for m in re.finditer(r"\[[^\]]*\]\(([^)\s]+)\)", text):
            href = m.group(1)
            if href.startswith(("http://", "https://", "mailto:", "data:")):
                continue
            # Strip optional title: path "title"
            href = href.split()[0].strip('"')
            path, _, frag = href.partition("#")
            if path:
                target = os.path.normpath(
                    os.path.join(os.path.dirname(rel) or ".", path)
                ).replace("\\", "/")
                if not os.path.exists(os.path.join(ROOT, target)):
                    problems.append(f"{rel}: link to missing file {href}")
                    continue
            else:
                target = rel
            if not frag:
                continue
            # GitHub line anchors (#L12, #L12-L20) on source files are fine.
            if not target.endswith((".md", ".mdx")):
                continue
            if target not in cache:
                cache[target] = anchors(os.path.join(ROOT, target))
            if frag not in cache[target]:
                problems.append(f"{rel}: link to missing anchor {href}")


def check_naming(files: list[str], problems: list[str]) -> None:
    for rel in files:
        if not rel.startswith("docs/"):
            continue
        name = os.path.basename(rel)
        if name == "README.md":
            continue
        if not KEBAB.match(name):
            problems.append(
                f"{rel}: docs filename must be kebab-case.md (got {name!r})"
            )


def check_no_frontmatter(files: list[str], problems: list[str]) -> None:
    for rel in files:
        if not rel.startswith("docs/"):
            continue
        text = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        if text.startswith("---\n"):
            problems.append(f"{rel}: YAML frontmatter is forbidden under docs/")


def check_hygiene(files: list[str], problems: list[str]) -> None:
    for rel in files:
        text = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        in_fence = False
        for i, line in enumerate(text.splitlines(), start=1):
            if line.startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            # Strip inline code so examples in docs/README.md hygiene do not trip.
            stripped = re.sub(r"`[^`]*`", "", line)
            if FORBIDDEN_PATH.search(stripped):
                problems.append(
                    f"{rel}:{i}: forbidden personal/local path "
                    f"(see docs/README.md hygiene)"
                )


def main() -> int:
    files = markdown_files()
    problems: list[str] = []
    check_links(files, problems)
    check_naming(files, problems)
    check_no_frontmatter(files, problems)
    check_hygiene(files, problems)

    for p in problems:
        print(p)
    print(f"{len(files)} files checked, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
