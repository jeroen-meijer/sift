#!/usr/bin/env python3
"""Check that external http(s) links in the docs resolve.

`tool/check-docs.py` covers internal links and anchors on every edit. This
script is the external counterpart. Run it by hand: it needs the network and
is slow. It is not part of `bun run docs:check`. A flaky site or temporary
timeout should not block an unrelated doc edit.

    ./tool/check-links.py
    # or
    bun run docs:links

Exit code 1 if any link comes back broken.
"""

from __future__ import annotations

import concurrent.futures
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIMEOUT = 10
UA = "Mozilla/5.0 (compatible; sift-check-links; +local docs link check)"

SKIP_DIRS = {
    ".git",
    "node_modules",
    "target",
    "dist",
    "dist-ssr",
    "_ds",
}


def markdown_files() -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        dirnames[:] = [
            d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")
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


def find_links(files: list[str]) -> dict[str, list[str]]:
    link_re = re.compile(
        r"\[[^\]]*\]\((https?://[^)\s]+)\)|<(https?://[^>\s]+)>"
    )
    links: dict[str, list[str]] = {}
    for rel in files:
        text = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        for m in link_re.finditer(text):
            url = (m.group(1) or m.group(2)).rstrip(".,;")
            links.setdefault(url, []).append(rel)
    return links


def check(url: str) -> tuple[int | None, str | None]:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, None
    except urllib.error.HTTPError as e:
        if e.code in (405, 403):
            try:
                req2 = urllib.request.Request(
                    url, method="GET", headers={"User-Agent": UA}
                )
                with urllib.request.urlopen(req2, timeout=TIMEOUT) as resp:
                    return resp.status, None
            except urllib.error.HTTPError as e2:
                return e2.code, str(e2)
            except Exception as e2:  # noqa: BLE001 - report any network fail
                return None, str(e2)
        return e.code, str(e)
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def main() -> int:
    files = markdown_files()
    links = find_links(files)
    print(f"Checking {len(links)} external links across {len(files)} files...")

    problems: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(check, url): url for url in links}
        for fut in concurrent.futures.as_completed(futures):
            url = futures[fut]
            status, err = fut.result()
            if status is None or status >= 400:
                where = ", ".join(links[url])
                problems.append(f"{url} ({where}): {err or status}")

    for p in sorted(problems):
        print(p)
    print(f"{len(links)} links checked, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
