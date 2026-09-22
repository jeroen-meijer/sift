#!/usr/bin/env sh
# Prepare a release: rewrite CHANGELOG, sync versions, commit, push to main
# (default) so Publish Release builds macOS + Windows installers.
#
# Usage:
#   ./tool/prepare_release.sh <x.y.z>        # commit on main and push (triggers publish)
#   ./tool/prepare_release.sh <x.y.z> --pr   # Loudline-style release PR instead
#
# Requires: git, gh, bun, awk; clean working tree; run from repo root.

set -eu

ROOT="$(CDPATH='' cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHANGELOG_PATH="CHANGELOG.md"
PACKAGE_PATH="package.json"
CHANGELOG_REWRITE_SCRIPT="$ROOT/tool/rewrite_changelog_for_release.sh"
RELEASE_LABEL="release"
MODE="main"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <x.y.z> [--pr]" >&2
  exit 2
fi
VERSION="$1"
if [ "$#" -eq 2 ]; then
  if [ "$2" = "--pr" ]; then
    MODE="pr"
  else
    echo "usage: $0 <x.y.z> [--pr]" >&2
    exit 2
  fi
fi

echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
  echo "error: version must be semver x.y.z (e.g. 1.3.0)" >&2
  exit 2
}

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty; commit or stash first." >&2
  exit 1
fi

git fetch origin main --tags

if git ls-remote --exit-code --tags origin "refs/tags/${VERSION}" >/dev/null 2>&1; then
  echo "error: tag ${VERSION} already exists on origin." >&2
  exit 1
fi

if gh release view "$VERSION" >/dev/null 2>&1; then
  echo "error: GitHub release ${VERSION} already exists." >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"

if [ "$MODE" = "pr" ]; then
  if ! gh label list --json name --jq '.[].name' | grep -qx "$RELEASE_LABEL"; then
    echo "error: GitHub label \"${RELEASE_LABEL}\" not found. Create it in the repo first." >&2
    exit 1
  fi
  BRANCH="chore/release-${VERSION}"
  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    echo "error: branch ${BRANCH} already exists." >&2
    exit 1
  fi
  git checkout -b "$BRANCH"
else
  if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "error: direct release must run on main (current: ${CURRENT_BRANCH}). Use --pr or checkout main." >&2
    exit 1
  fi
  git pull --ff-only origin main
fi

"$CHANGELOG_REWRITE_SCRIPT" "$VERSION" \
  "$ROOT/$CHANGELOG_PATH" "$ROOT/$CHANGELOG_PATH"

bun tool/sync-version.ts "$VERSION"

if ! bun run lint; then
  echo "error: bun run lint failed; fix issues and retry." >&2
  exit 1
fi

if ! bun run typecheck; then
  echo "error: bun run typecheck failed; fix issues and retry." >&2
  exit 1
fi

if ! bun run build; then
  echo "error: bun run build failed; fix issues and retry." >&2
  exit 1
fi

git add "$CHANGELOG_PATH" "$PACKAGE_PATH" src-tauri/tauri.conf.json src-tauri/Cargo.toml
# Cargo.lock may change if the version bump touches the package stanza only. Add it when dirty.
if git status --porcelain -- src-tauri/Cargo.lock | grep -q .; then
  git add src-tauri/Cargo.toml src-tauri/Cargo.lock
fi

git commit -m "chore: prepare release ${VERSION}"

if [ "$MODE" = "pr" ]; then
  git push -u origin "chore/release-${VERSION}"
  gh pr create \
    --title "chore: release ${VERSION}" \
    --label "$RELEASE_LABEL" \
    --body "Prepare release **${VERSION}**: changelog section and synced \`package.json\` / Tauri metadata.

Merge with **squash** after CI passes. Merging this PR (with the \`${RELEASE_LABEL}\` label) builds desktop installers, creates a GitHub release, and tags \`main\` with \`${VERSION}\`.

To retry a failed publish: Actions → **Publish Release** → **Run workflow** with version \`${VERSION}\`."
  echo "Opened release PR (label: ${RELEASE_LABEL})."
else
  git push origin main
  echo "Pushed release prepare to main. Publish Release should build macOS + Windows installers for ${VERSION}."
  echo "Retry: Actions → Publish Release → Run workflow → ${VERSION}"
fi
