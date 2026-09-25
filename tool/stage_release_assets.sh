#!/usr/bin/env sh
# Copy Tauri bundle outputs into a release folder: hand installers plus updater
# files (.sig, macOS .app.tar.gz).
#
# Usage (repo root, bash on CI):
#   ./tool/stage_release_assets.sh <bundle-dir> <out-dir>
#
# bundle-dir is usually src-tauri/target/release/bundle
#
# Tauri's default versioned names stay for the updater (latest.json + .sig).
# Hand installers also get a stable alias with OS in the name so README can use
#   …/releases/latest/download/Sift_macOS_aarch64.dmg
#   …/releases/latest/download/Sift_Windows_x64-setup.exe
# (same idea as Spacedrive's unversioned darwin/windows assets, or a second
# upload beside tauri-action's versioned names).

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

# Stable hand-install names: drop _x.y.z_, insert macOS_ or Windows_ after product.
# Sift_0.3.1_aarch64.dmg       → Sift_macOS_aarch64.dmg
# Sift_0.3.1_x64-setup.exe     → Sift_Windows_x64-setup.exe
# Sift_0.3.1_x64_en-US.msi     → Sift_Windows_x64_en-US.msi
stage_stable_aliases() {
  for path in "$OUT"/*; do
    [ -f "$path" ] || continue
    name=$(basename "$path")
    case "$name" in
      *.app.tar.gz | *.sig) continue ;;
      *.dmg) os="macOS" ;;
      *-setup.exe | *.msi) os="Windows" ;;
      *) continue ;;
    esac

    # product_x.y.z_rest → product + rest
    product=$(printf '%s\n' "$name" | sed -E 's/^(.+)_[0-9]+\.[0-9]+\.[0-9]+_.+$/\1/')
    rest=$(printf '%s\n' "$name" | sed -E 's/^.+_[0-9]+\.[0-9]+\.[0-9]+_(.+)$/\1/')
    if [ "$product" = "$name" ] || [ "$rest" = "$name" ] || [ -z "$product" ] || [ -z "$rest" ]; then
      continue
    fi

    stable="${product}_${os}_${rest}"
    if [ -e "$OUT/$stable" ]; then
      echo "error: stable alias already exists: $stable (from $name)" >&2
      exit 1
    fi
    cp "$path" "$OUT/$stable"
    echo "stable alias: $name -> $stable"
  done
}

stage_stable_aliases

if [ -z "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "error: no release assets staged from $BUNDLE" >&2
  find "$BUNDLE" -type f 2>/dev/null | head -50 || true
  exit 1
fi

echo "Staged release assets:"
ls -la "$OUT"
