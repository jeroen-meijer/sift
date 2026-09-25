# Brand icons

Edit the icon and logo here. The files the app ships are generated into [`src-tauri/icons/`](../../src-tauri/icons/).

## Layout

| Path | Role |
| --- | --- |
| `mark.svg` / `mark-1024.png` | Transparent logo mark |
| `tile.svg` | Full-bleed square tile (Windows, Linux, `tauri icon` input) |
| `macos-1024.png` / `macos-1024.svg` | Classic macOS icon: 824 px body on 1024 canvas with shadow |
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

## Do not

- Treat `src-tauri/icons/` as the design source
- Build Windows or Linux icons from the inset `macos-1024.png`
- Leave the `ios/` / `android/` trees that `bun tauri icon` writes (this app is desktop only)
