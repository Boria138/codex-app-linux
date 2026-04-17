# Codex macOS DMG -> Linux Repack

This repository contains:

- `repack.sh` — a script that repacks upstream `Codex.dmg` into Linux artifacts.
- GitHub Actions automation that checks upstream DMG updates and publishes new GitHub Releases automatically.

The project is Linux-focused and produces portable build artifacts without distro-specific packaging.

## What `repack.sh` does

1. Downloads (or reuses cached) upstream `Codex.dmg`.
2. Extracts `Codex.app` payload (`app.asar`, `app.asar.unpacked`, app metadata).
3. Removes macOS-only artifacts (`sparkle-darwin`, `*.dylib`, `sparkle.node`).
4. Rebuilds native modules (`better-sqlite3`, `node-pty`) for Linux/Electron.
5. Re-packs `app.asar` with native unpack rules.
6. Builds Linux `dir`, `AppImage`, and `tar.gz` artifacts via `electron-builder`.
7. Forces Electron to use X11/XWayland instead of native Wayland.
8. Produces release-ready artifacts:
   - `codex-linux-repack-<version>-x86_64.AppImage`
   - `codex-linux-repack-<version>-x86_64.tar.gz`

## Local usage

```bash
bash ./repack.sh
```

Useful environment variables:

- `UPSTREAM_URL` — DMG source URL  
  default: `https://persistent.oaistatic.com/codex-app-prod/Codex.dmg`
- `CODEX_CLI_URL` — Linux Codex CLI archive URL  
  default: `https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-gnu.tar.gz`
- `FORCE_DOWNLOAD=1` — force DMG re-download
- `DMG_PATH` — custom local DMG path

## Automated GitHub Releases (no AUR)

Workflow:

- `.github/workflows/auto-release.yml`

Behavior:

1. Periodically checks upstream DMG hash.
2. If DMG changed, runs repack build.
3. Publishes GitHub Release with:
   - built `.AppImage`
   - built `.tar.gz`
   - `sha256sums.txt`
4. Updates and commits `upstream.sha256` in this repo.

## Release helper scripts

- `scripts/check_upstream.sh` — detect upstream DMG changes
- `scripts/build_release_artifacts.sh` — run repack and collect artifacts
- `scripts/publish_release.sh` — create/update GitHub release assets

## Notes

- The generated bootstrap forces Electron to start with `--ozone-platform=x11`, so on Wayland sessions the app runs through XWayland.
- The app is configured to use bundled Linux `resources/codex` inside the packaged artifact.
- `repack.sh` downloads the latest Linux `codex` CLI archive from GitHub Releases and copies `codex-x86_64-unknown-linux-gnu` into `resources/codex`.
