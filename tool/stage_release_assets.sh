#!/usr/bin/env sh
# Copy Tauri bundle outputs into a release folder: hand installers plus updater
# files (.sig, macOS .app.tar.gz).
#
# Usage (repo root, bash on CI):
#   ./tool/stage_release_assets.sh <bundle-dir> <out-dir>
#
# bundle-dir is usually src-tauri/target/release/bundle
#
# latest.json uses the NSIS *-setup.exe on Windows. MSI is staged for hand install.

set -eu

BUNDLE="${1:?bundle dir}"
OUT="${2:?out dir}"

if [ ! -d "$BUNDLE" ]; then
  echo "error: bundle dir not found: $BUNDLE" >&2
  exit 1
fi

mkdir -p "$OUT"

# Copy matches without relying on find -exec +.
stage_glob() {
  pattern="$1"
  find "$BUNDLE" -type f -name "$pattern" 2>/dev/null | while IFS= read -r path; do
    cp "$path" "$OUT/"
  done
}

stage_glob "*.dmg"
stage_glob "*.app.tar.gz"
stage_glob "*.app.tar.gz.sig"
stage_glob "*-setup.exe"
stage_glob "*-setup.exe.sig"
stage_glob "*.msi"
stage_glob "*.msi.sig"

# Tauri sometimes drops NSIS binaries under nsis/ without -setup in the name.
if [ -d "$BUNDLE/nsis" ]; then
  find "$BUNDLE/nsis" -type f \( -name "*.exe" -o -name "*.exe.sig" \) 2>/dev/null \
    | while IFS= read -r path; do
        cp "$path" "$OUT/"
      done
fi

if [ -z "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "error: no release assets staged from $BUNDLE" >&2
  find "$BUNDLE" -type f 2>/dev/null | head -50 || true
  exit 1
fi

echo "Staged release assets:"
ls -la "$OUT"
