# Sift

<p align="center">
  <img src="assets/screenshot.png" alt="Sift" style="max-height: 550px; width: auto;" />
</p>

<p align="center">
  <strong>Local desktop sample manager for producers and audio engineers.<br/>Browse, play, tag, and drag samples into your DAW. macOS and Windows.</strong>
</p>

<p align="center">
  <a href="https://github.com/jeroen-meijer/sift/releases/latest/download/Sift_macOS_aarch64.dmg"><img alt="Download (Apple Silicon)" src="https://img.shields.io/badge/Download-macOS%20(Apple%20Silicon)-black?style=for-the-badge&logo=apple&logoColor=white" /></a>
  <a href="https://github.com/jeroen-meijer/sift/releases/latest/download/Sift_Windows_x64-setup.exe"><img alt="Download" src="https://img.shields.io/badge/Download-Windows-blue?style=for-the-badge&logo=windows&logoColor=white" /></a>
</p>

## Features

- **Browse:** Large local libraries across multiple folders
- **Preview:** Instantly listen to samples while you browse
- **Search:** Name, tags, BPM, key, type, and folder
- **Drag:** Full files or a waveform clip into a DAW
- **Tag:** Favorite or tag samples, and create custom tags
- **Analyze:** BPM, key, loop/one-shot, suggested tags in the background
- **Integrations:** Integrates with 3rd party tools like [Splice](https://splice.com/) to automatically set BPM and key
- **Formats:** WAV, AIFF, FLAC, MP3, AAC/M4A, OGG, Opus

## Build from source

Needs Bun, Rust nightly (pinned in `src-tauri/rust-toolchain.toml`), and Xcode Command Line Tools on macOS.

```bash
bun install
bun run tauri:dev
```

Add a sample folder (try `example_samples/` in this repo), then browse and play.

Lint, test, release, and contributor conventions: [AGENTS.md](AGENTS.md).
Docs map for agents and maintainers: [docs/README.md](docs/README.md).
