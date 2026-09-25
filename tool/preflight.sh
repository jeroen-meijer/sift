#!/usr/bin/env sh
# Same checks as .github/workflows/ci.yml, on this machine, before you push.
# Usage (repo root): ./tool/preflight.sh
#
# Runs: rustfmt check, clippy (-D warnings), nextest, eslint, tsc, vitest.
# Does not cross-compile for Linux. Code under cfg(not(target_os = "macos"))
# still only gets Clippy on CI. Keep those stubs as const fn with no logic.

set -eu

ROOT="$(CDPATH='' cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

run() {
  label="$1"
  shift
  echo "==> $label"
  if "$@"; then
    echo "OK  $label"
  else
    echo "FAIL $label" >&2
    fail=1
  fi
}

run "cargo fmt --check" sh -c 'cd src-tauri && cargo fmt --all -- --check'
run "cargo clippy" sh -c 'cd src-tauri && cargo clippy --locked --all-targets --all-features -- -D warnings'
run "cargo nextest" sh -c 'cd src-tauri && cargo nextest run --locked --all-features'
run "bun lint" bun run lint
run "bun typecheck" bun run typecheck
run "bun test" bun run test

if [ "$fail" -ne 0 ]; then
  echo "preflight failed" >&2
  exit 1
fi
echo "preflight ok"
