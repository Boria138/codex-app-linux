# Codex macOS DMG -> Linux AppImage Repack

This repository contains:

- `repack.sh` — a script that repacks upstream `Codex.dmg` into a Linux AppImage with internal Electron runtime.
- GitHub Actions automation that checks upstream DMG updates and publishes new GitHub Releases automatically.

The project is Linux-focused and not tied to a specific distro by name in the build output format (AppImage).

## What `repack.sh` does

1. Downloads (or reuses cached) upstream `Codex.dmg`.
2. Extracts `Codex.app` payload (`app.asar`, `app.asar.unpacked`, bundled `codex` binary).
3. Removes macOS-only artifacts (`sparkle-darwin`, `*.dylib`, `sparkle.node`).
4. Rebuilds native modules (`better-sqlite3`, `node-pty`) for Linux/Electron.
5. Re-packs `app.asar` with native unpack rules.
6. Builds Linux `AppImage` via `electron-builder` (internal Electron runtime).
7. Produces a release-ready artifact:
   - `codex-linux-repack-<version>-<dmgsha12>-x86_64.AppImage`

## Local usage

```bash
bash ./repack.sh
```

Useful environment variables:

- `UPSTREAM_URL` — DMG source URL  
  default: `https://persistent.oaistatic.com/codex-app-prod/Codex.dmg`
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
   - `sha256sums.txt`
4. Updates and commits `upstream.sha256` in this repo.

## Release helper scripts

- `scripts/check_upstream.sh` — detect upstream DMG changes
- `scripts/build_release_artifacts.sh` — run repack and collect artifacts
- `scripts/publish_release.sh` — create/update GitHub release assets

## Notes

- AppImage contains internal Electron runtime.
- The app is configured to use bundled `resources/codex` inside the packaged artifact.
