#!/usr/bin/env sh
# Copy Tauri bundle outputs into a release folder: hand installers plus updater
# files (.sig, macOS .app.tar.gz).
#
# Usage (repo root, bash on CI):
#   ./tool/stage_release_assets.sh <bundle-dir> <out-dir> [updater-arch]
#
# bundle-dir is usually:
#   src-tauri/target/release/bundle                         (host / Windows)
#   src-tauri/target/<triple>/release/bundle                (macOS --target)
#
# Optional updater-arch (e.g. aarch64, x64) renames macOS *.app.tar.gz (+ .sig)
# so dual-arch publish jobs do not collide on the bare ProductName.app.tar.gz
# name Tauri emits. DMGs already include the arch in the filename.
#
# Keep Tauri's versioned names for the updater (latest.json + .sig). Also copy
# hand installers under stable names so README can link forever:
#   …/releases/latest/download/Sift_macOS_aarch64.dmg
#   …/releases/latest/download/Sift_macOS_x64.dmg
#   …/releases/latest/download/Sift_Windows_x64-setup.exe

set -eu

BUNDLE="${1:?bundle dir}"
OUT="${2:?out dir}"
UPDATER_ARCH="${3:-}"

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

# Rename bare ProductName.app.tar.gz → ProductName_<arch>.app.tar.gz (+ .sig).
rename_updater_arch() {
  arch="$1"
  for path in "$OUT"/*.app.tar.gz; do
    [ -f "$path" ] || continue
    case "$path" in
      *.app.tar.gz.sig) continue ;;
    esac
    name=$(basename "$path")
    # Already arch-tagged (e.g. Sift_aarch64.app.tar.gz) — leave alone.
    case "$name" in
      *_"${arch}".app.tar.gz) continue ;;
      *_aarch64.app.tar.gz | *_arm64.app.tar.gz | *_x64.app.tar.gz | *_x86_64.app.tar.gz)
        continue
        ;;
    esac
    # Strip trailing .app.tar.gz → insert _<arch> before it.
    base=${name%.app.tar.gz}
    dest="$OUT/${base}_${arch}.app.tar.gz"
    if [ -e "$dest" ]; then
      echo "error: updater rename destination exists: $dest" >&2
      exit 1
    fi
    mv "$path" "$dest"
    echo "updater rename: $name -> $(basename "$dest")"
    if [ -f "$OUT/${name}.sig" ]; then
      mv "$OUT/${name}.sig" "${dest}.sig"
      echo "updater rename: ${name}.sig -> $(basename "$dest").sig"
    fi
  done
}

if [ -n "$UPDATER_ARCH" ]; then
  rename_updater_arch "$UPDATER_ARCH"
fi

# Stable hand-install names: drop _x.y.z_, insert macOS_ or Windows_ after product.
# Sift_0.3.1_aarch64.dmg       → Sift_macOS_aarch64.dmg
# Sift_0.3.1_x64.dmg           → Sift_macOS_x64.dmg
# Sift_0.3.1_x64-setup.exe     → Sift_Windows_x64-setup.exe
# Sift_0.3.1_x64_en-US.msi     → Sift_Windows_x64_en-US.msi
stage_stable_copies() {
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
      echo "error: stable name already exists: $stable (from $name)" >&2
      exit 1
    fi
    cp "$path" "$OUT/$stable"
    echo "stable copy: $name -> $stable"
  done
}

stage_stable_copies

if [ -z "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "error: no release assets staged from $BUNDLE" >&2
  find "$BUNDLE" -type f 2>/dev/null | head -50 || true
  exit 1
fi

echo "Staged release assets:"
ls -la "$OUT"
