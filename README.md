# Codex App for Linux (DMG Repack)

Unofficial Linux port of the OpenAI Codex Desktop application. This project converts the official macOS `.dmg` into a functional Linux AppImage by replacing native modules and applying compatibility patches.

## Key Improvements in this Build

- **Automatic Extraction:** Robust DMG extraction using `7zz` with fallback for APFS support.
- **Dynamic Native Modules:** Automatically detects and rebuilds `better-sqlite3`, `node-pty`, `sharp`, and `@napi-rs/canvas` for your Linux architecture.
- **Linux-First Patches:**
  - **Single Instance:** Prevents multiple copies of the app from running simultaneously.
  - **Opaque Background:** Fixes rendering artifacts on Linux compositors (especially NVIDIA/Wayland).
  - **Window Focus:** Ports the primary `BrowserWindow` focusability fix from `ilysenko/codex-desktop-linux`.
  - **Core Linux Fixes:** Ports selected self-contained ilysenko core patches for menu visibility, resize repaint, XDG Documents, and git origins fallback.
  - **Stability:** Prevents crashes in the "About" dialog and improves "Open in File Manager" / editor target handling.

## Prerequisites

Before running the repack script, ensure you have the following dependencies installed:

### Debian / Ubuntu
```bash
sudo apt-get update
sudo apt-get install git curl nodejs npm python3 build-essential \
                     libsqlite3-dev pkg-config libx11-dev libxkbfile-dev
```

### Fedora
```bash
sudo dnf install git curl nodejs npm python3 gcc-c++ make \
                 sqlite-devel pkgconf-pkg-config libX11-devel libxkbfile-devel
```

## Usage

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Boria138/codex-app-linux.git
   cd codex-app-linux
   ```

2. **Run the repack script:**
   ```bash
   chmod +x repack.sh
   ./repack.sh
   ```
   The script will:
   - Check for required tools.
   - Download the latest `Codex.dmg` from OpenAI.
   - Extract and patch the application resources.
   - Rebuild native Node.js modules for Linux.
   - Pack the result into an **AppImage** and **tar.gz**.

3. **Find your build:**
   Artifacts will be located in the `artifacts/` directory.

## Acknowledgments

- **Primary Inspiration & Patching:** Selected Linux window/core patches are adapted from [ilysenko/codex-desktop-linux](https://github.com/ilysenko/codex-desktop-linux), especially its main-process window/core Linux compatibility fixes.
- **Open Targets:** The Linux open-targets patch is inspired by and adapted from the [openai-codex-desktop](https://aur.archlinux.org/packages/openai-codex-desktop) AUR package, with additional refinements for robustness and compatibility with newer upstream versions.
- **System Patches:** The `better-sqlite3` and opaque background patches are adapted from [dcelasun's Gist](https://gist.github.com/dcelasun/8d002bc05d32491204c0bf695bc6b3d6).
- **Build Strategy:** The environment variables for native module compilation and overall build approach are aligned with the [openai-codex-desktop](https://aur.archlinux.org/packages/openai-codex-desktop) AUR package standards.
- **Community:** Inspired by the Arch Linux community's tireless efforts to port and maintain Electron applications.
