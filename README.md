# Codex app macOS DMG -> Linux Repack

This repository contains:

- `repack.sh` — a script that repacks upstream `Codex.dmg` into Linux artifacts.
- `patch-linux-open-targets.mjs` — a helper script to patch application JavaScript for Linux compatibility (editors, file manager).
- GitHub Actions automation that checks upstream DMG updates and publishes new GitHub Releases automatically.

The project is Linux-focused and produces portable build artifacts without distro-specific packaging.

## What `repack.sh` does

1. Downloads (or reuses cached) upstream `Codex.dmg`.
2. Extracts the `Codex.app` macOS bundle payload (`app.asar`, `app.asar.unpacked`, app metadata).
3. Removes macOS-only artifacts (`sparkle-darwin`, `*.dylib`, `sparkle.node`).
4. **Patches application JavaScript** (`patch-linux-open-targets.mjs`) to support Linux-specific editors (VS Code, Cursor, Zed) and file managers.
5. Rebuilds native modules (`better-sqlite3`, `node-pty`) for Linux/Electron.
6. Re-packs `app.asar` with native unpack rules.
7. Builds Linux `dir`, `AppImage`, and `tar.gz` artifacts via `electron-builder`.
8. Produces release-ready artifacts:
   - `codex-app-<version>-x86_64.AppImage`
   - `codex-app-<version>-x86_64.tar.gz`

## Local usage

```bash
bash ./repack.sh
```

Useful environment variables:

- `UPSTREAM_URL` — DMG source URL  
  default: `https://persistent.oaistatic.com/codex-app-prod/Codex.dmg`
- `CODEX_CLI_URL` — Linux Codex CLI archive URL  
  default: `https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-musl.tar.gz`
- `FORCE_DOWNLOAD=1` — force DMG re-download
- `DMG_PATH` — custom local DMG path

## Automated GitHub Releases

Workflow:

- `.github/workflows/auto-release.yml`

Behavior:

1. Periodically checks upstream DMG hash.
2. If DMG changed, runs repack build.
3. Publishes GitHub Release with built artifacts and checksums.
4. Updates and commits `upstream.sha256` in this repo.

## Credits

- The Linux open-targets patch is inspired by and adapted from the [openai-codex-desktop](https://aur.archlinux.org/packages/openai-codex-desktop) AUR package, with additional refinements for robustness and compatibility with newer upstream versions.
- The build strategy (environment variables for native module compilation) is aligned with the same AUR package standards.

## Notes

- If the window flickers, renders incorrectly, or shows other display issues in a Wayland session, run the app through `Xwayland`, for example:
  - `./codex-app-<version>-x86_64.AppImage --ozone-platform=x11`
  - `./codex-app --ozone-platform=x11`
- The app is configured to use bundled Linux `resources/codex` inside the packaged artifact.
- `repack.sh` downloads the latest Linux `codex` CLI archive from GitHub Releases and copies `codex-x86_64-unknown-linux-musl` into `resources/codex`.
