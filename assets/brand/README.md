# Brand icons

Edit the icon and logo here. The files the app ships are generated into [`src-tauri/icons/`](../../src-tauri/icons/).

## Layout

| Path | Role |
| --- | --- |
| `mark.svg` / `mark-1024.png` | Transparent logo mark |
| `tile.svg` | Full-bleed square tile (Windows, Linux, `tauri icon` input) |
| `macos-1024.png` / `macos-1024.svg` | Classic macOS icon: 824 px body on 1024 canvas with shadow |
| `readme-lockup-dark.png` / `readme-lockup-light.png` | README header lockup (icon + "Sift"); GitHub picks via `prefers-color-scheme` |
| `AppIcon.icon/` | Icon Composer project (macOS 26 Liquid Glass). Open in Icon Composer to edit |
| `layers/` | Layer SVGs/PNG used to build or rebuild the Composer project |

Colors: ground `#292b31` to `#161826`, accent `#9184d9`, light `#e7e5fe`.

## Apply / regenerate

`tauri.conf.json` lists `../assets/brand/AppIcon.icon` with the PNG/icns/ico set. On build, Tauri 2.11+ compiles the `.icon` to `Assets.car` (needs Xcode 26 / `actool`). Older macOS and the DMG use `icon.icns`.

After you change source art, scrub and minify before you commit:

```bash
# SVGs: drop metadata / minify
find assets/brand -name '*.svg' -print0 | xargs -0 bunx svgo --multipass --precision=2

# PNGs: strip provenance chunks, then crush
find assets/brand -name '*.png' -print0 | while IFS= read -r -d '' f; do
  tmp=$(mktemp -t sift-png).png
  magick "$f" -strip PNG32:"$tmp" && mv "$tmp" "$f"
done
find assets/brand -name '*.png' -print0 | xargs -0 bunx oxipng -o 3 --strip safe
```

Then regenerate the shipped icons:

```bash
bun tauri icon assets/brand/tile.svg
rm -rf src-tauri/icons/android src-tauri/icons/ios
```

When the macOS inset art changes, re-export a classic `.icns` from Icon Composer (Platform: macOS pre-Tahoe, 1024pt, 1×). For Windows, build a full-bleed `icon.ico` from `tile.svg` or a size set. Do not use `macos-1024.png` for Windows or Linux.

Rebuild the README lockups after the macOS icon or wordmark changes (SF Compact Display Bold, same icon both themes):

```bash
FONT="/Library/Fonts/SF-Compact-Display-Bold.otf"
ICON=assets/brand/macos-1024.png
for pair in "dark:#e9e9ed" "light:#1f2328"; do
  theme="${pair%%:*}"
  fill="${pair#*:}"
  magick -background none \
    \( "$ICON" -resize 112x112 \) \
    \( -background none -fill "$fill" -font "$FONT" -pointsize 72 label:'Sift' \) \
    -gravity center +smush 14 \
    -strip PNG32:"assets/brand/readme-lockup-$theme.png"
done
bunx oxipng -o 3 --strip safe assets/brand/readme-lockup-*.png
```

## Do not

- Treat `src-tauri/icons/` as the design source
- Build Windows or Linux icons from the inset `macos-1024.png`
- Leave the `ios/` / `android/` trees that `bun tauri icon` writes (this app is desktop only)
