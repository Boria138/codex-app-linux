#!/usr/bin/env bash
set -euo pipefail

##
## Codex macOS -> Linux AppImage repack (with internal Electron)
## Usage:
##   bash ./repack.sh
##

echo "=== [0] System check ==="

SUDO=""
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  SUDO="sudo"
fi

ARCH="$(uname -m 2>/dev/null || echo unknown)"
if [ "$ARCH" != "x86_64" ]; then
  echo "ERROR: only x86_64 is supported (detected: $ARCH)." >&2
  exit 1
fi

for cmd in pacman curl 7z node npm python3 tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command missing: $cmd" >&2
    exit 1
  fi
done

echo
echo "=== [1] Fetch Codex.dmg ==="
UPSTREAM_URL="${UPSTREAM_URL:-https://persistent.oaistatic.com/codex-app-prod/Codex.dmg}"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$HOME/Downloads/codex-macos}"
mkdir -p "$DOWNLOAD_DIR"
DMG_PATH="${DMG_PATH:-$DOWNLOAD_DIR/Codex.dmg}"

if [ "${FORCE_DOWNLOAD:-0}" = "1" ] || [ ! -f "$DMG_PATH" ]; then
  tmp_dmg="${DMG_PATH}.tmp"
  rm -f "$tmp_dmg"
  curl -fL --retry 3 --retry-delay 2 "$UPSTREAM_URL" -o "$tmp_dmg"
  mv "$tmp_dmg" "$DMG_PATH"
else
  echo "Using cached DMG: $DMG_PATH"
fi

echo
echo "=== [2] Install build dependencies ==="
if ! command -v pacman >/dev/null 2>&1; then
  echo "ERROR: pacman not found. This script is for Manjaro/Arch." >&2
  exit 1
fi

"$SUDO" pacman -S --needed p7zip nodejs npm python base-devel git libarchive

if ! command -v pnpm >/dev/null 2>&1; then
  "$SUDO" npm i -g pnpm
fi

PNPM_BIN="$(command -v pnpm)"
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
mkdir -p "$PNPM_HOME"

echo
echo "=== [3] Extract DMG and app payload ==="
ROOT_APP_DIR="$HOME/apps/codex-port"
mkdir -p "$ROOT_APP_DIR"
cd "$ROOT_APP_DIR"

rm -rf "$ROOT_APP_DIR/dmg_extracted" "$ROOT_APP_DIR/app_extracted" "$ROOT_APP_DIR/app.asar.unpacked"
7z x -y -aoa "$DMG_PATH" -o./dmg_extracted

APP_BUNDLE_DIR="$(find ./dmg_extracted -maxdepth 6 -type d -name '*.app' -print | head -n 1 || true)"
if [ -z "$APP_BUNDLE_DIR" ]; then
  echo "ERROR: .app bundle not found in extracted DMG." >&2
  exit 1
fi

APP_ASAR_PATH="$APP_BUNDLE_DIR/Contents/Resources/app.asar"
if [ ! -f "$APP_ASAR_PATH" ]; then
  echo "ERROR: app.asar not found at expected path: $APP_ASAR_PATH" >&2
  exit 1
fi
APP_CODEX_BIN="$APP_BUNDLE_DIR/Contents/Resources/codex"
if [ ! -f "$APP_CODEX_BIN" ]; then
  echo "ERROR: codex CLI binary not found at expected path: $APP_CODEX_BIN" >&2
  exit 1
fi

APP_VERSION="$(python3 - "$APP_BUNDLE_DIR/Contents/Info.plist" <<'PY'
import plistlib
import re
import sys

with open(sys.argv[1], "rb") as f:
    p = plistlib.load(f)

version = p.get("CFBundleShortVersionString") or p.get("CFBundleVersion") or "0.0.0"
version = version.replace("-", ".")
version = re.sub(r"[^0-9A-Za-z._-]", "", version)
print(version)
PY
)"
if [ -z "$APP_VERSION" ]; then
  APP_VERSION="0.0.0"
fi
echo "App version: $APP_VERSION"

"$PNPM_BIN" dlx asar extract "$APP_ASAR_PATH" "$ROOT_APP_DIR/app_extracted"

if [ -d "$APP_BUNDLE_DIR/Contents/Resources/app.asar.unpacked" ]; then
  cp -a "$APP_BUNDLE_DIR/Contents/Resources/app.asar.unpacked" "$ROOT_APP_DIR/"
fi

if [ ! -f "$ROOT_APP_DIR/app_extracted/package.json" ]; then
  echo "ERROR: extracted app has no package.json." >&2
  exit 1
fi

echo "Cleaning macOS-only artifacts..."
rm -rf "$ROOT_APP_DIR/app_extracted/node_modules/sparkle-darwin" || true
find "$ROOT_APP_DIR/app_extracted" -type f \( -name "*.dylib" -o -name "sparkle.node" \) -delete || true

echo
echo "=== [4] Detect Electron version (from DMG, with fallback) ==="
ELECTRON_VERSION=""
ELECTRON_INFO_PLIST="$(find ./dmg_extracted -path "*/Electron Framework.framework/Versions/A/Resources/Info.plist" -print | head -n 1 || true)"
if [ -n "$ELECTRON_INFO_PLIST" ] && [ -f "$ELECTRON_INFO_PLIST" ]; then
  ELECTRON_VERSION="$(python3 - "$ELECTRON_INFO_PLIST" <<'PY'
import plistlib
import re
import sys

with open(sys.argv[1], "rb") as f:
    p = plistlib.load(f)

v = str(p.get("CFBundleVersion") or "").strip()
v = re.sub(r"^[^0-9]+", "", v)
print(v)
PY
)"
fi

if [ -z "$ELECTRON_VERSION" ]; then
  ELECTRON_VERSION="$(node -p "(() => { try { const p=require('$ROOT_APP_DIR/app_extracted/package.json'); return String((p.devDependencies&&p.devDependencies.electron)||''); } catch { return ''; } })()" | sed 's/^[^0-9]*//')"
fi

if [ -z "$ELECTRON_VERSION" ]; then
  echo "WARN: failed to detect Electron version, using fallback 40.0.0"
  ELECTRON_VERSION="40.0.0"
fi

echo "Electron version: $ELECTRON_VERSION"

echo
echo "=== [5] Native modules: strict versions + local tgz rebuild ==="
TMP_BUILD_DIR="$ROOT_APP_DIR/_native-build"
NATIVE_TGZ_DIR="$ROOT_APP_DIR/_native-tgz"
rm -rf "$TMP_BUILD_DIR" "$NATIVE_TGZ_DIR"
mkdir -p "$TMP_BUILD_DIR" "$NATIVE_TGZ_DIR"

BSQL_VERSION="$(node -p "(() => { try { return require('$ROOT_APP_DIR/app_extracted/node_modules/better-sqlite3/package.json').version } catch { return '' } })()")"
NODE_PTY_VERSION="$(node -p "(() => { try { return require('$ROOT_APP_DIR/app_extracted/node_modules/node-pty/package.json').version } catch { return '' } })()")"

if [ -z "$BSQL_VERSION" ] || [ -z "$NODE_PTY_VERSION" ]; then
  echo "ERROR: failed to detect better-sqlite3/node-pty versions from extracted app." >&2
  exit 1
fi

echo "better-sqlite3 version: $BSQL_VERSION"
echo "node-pty version      : $NODE_PTY_VERSION"

BSQL_TGZ="$NATIVE_TGZ_DIR/better-sqlite3-$BSQL_VERSION.tgz"
NODE_PTY_TGZ="$NATIVE_TGZ_DIR/node-pty-$NODE_PTY_VERSION.tgz"
curl -fL "https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-$BSQL_VERSION.tgz" -o "$BSQL_TGZ"
curl -fL "https://registry.npmjs.org/node-pty/-/node-pty-$NODE_PTY_VERSION.tgz" -o "$NODE_PTY_TGZ"

cat > "$TMP_BUILD_DIR/package.json" <<EOF
{
  "name": "codex-native-rebuild",
  "private": true,
  "version": "1.0.0"
}
EOF

cd "$TMP_BUILD_DIR"
npm install \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  "$BSQL_TGZ" \
  "$NODE_PTY_TGZ"

export npm_config_runtime=electron
export npm_config_target="$ELECTRON_VERSION"
export npm_config_disturl="https://electronjs.org/headers"
export npm_config_build_from_source=true

"$PNPM_BIN" dlx electron-rebuild --version "$ELECTRON_VERSION" --arch x64 --module-dir "$TMP_BUILD_DIR" --force --only "better-sqlite3,node-pty"

for dep in better-sqlite3 node-pty; do
  if [ ! -d "$TMP_BUILD_DIR/node_modules/$dep" ]; then
    echo "ERROR: rebuilt module missing: $dep" >&2
    exit 1
  fi
done

rm -rf "$ROOT_APP_DIR/app_extracted/node_modules/better-sqlite3"
rm -rf "$ROOT_APP_DIR/app_extracted/node_modules/node-pty"
cp -a "$TMP_BUILD_DIR/node_modules/better-sqlite3" "$ROOT_APP_DIR/app_extracted/node_modules/"
cp -a "$TMP_BUILD_DIR/node_modules/node-pty" "$ROOT_APP_DIR/app_extracted/node_modules/"

echo
echo "=== [6] Repack app.asar with native unpack pattern ==="
REPACKED_ASAR="$ROOT_APP_DIR/app.asar"
"$PNPM_BIN" dlx asar pack "$ROOT_APP_DIR/app_extracted" "$REPACKED_ASAR" --unpack "{*.node,*.so}"

if [ ! -f "$REPACKED_ASAR" ]; then
  echo "ERROR: failed to create repacked app.asar." >&2
  exit 1
fi

echo
echo "=== [7] Prepare electron-builder project (internal Electron) ==="
BUILDER_DIR="$ROOT_APP_DIR/_electron-builder"
rm -rf "$BUILDER_DIR"
mkdir -p "$BUILDER_DIR/resources"

APP_PRODUCT_NAME="$(node -p "(() => { try { const p=require('$ROOT_APP_DIR/app_extracted/package.json'); return p.productName || p.name || 'Codex'; } catch { return 'Codex'; } })()")"
APP_EXECUTABLE_NAME="codex-app-linux-port"

cp -a "$REPACKED_ASAR" "$BUILDER_DIR/resources/app.asar"
cp -a "$APP_CODEX_BIN" "$BUILDER_DIR/resources/codex"
chmod +x "$BUILDER_DIR/resources/codex"
if [ -d "$ROOT_APP_DIR/app.asar.unpacked" ]; then
  cp -a "$ROOT_APP_DIR/app.asar.unpacked" "$BUILDER_DIR/resources/"
else
  mkdir -p "$BUILDER_DIR/resources/app.asar.unpacked"
fi

cat > "$BUILDER_DIR/bootstrap.js" <<'EOF'
const path = require("path");
process.env.ELECTRON_FORCE_IS_PACKAGED = "1";
process.env.NODE_ENV = "production";
process.env.CODEX_CLI_PATH = path.join(process.resourcesPath, "codex");
require(path.join(process.resourcesPath, "app.asar"));
EOF

cat > "$BUILDER_DIR/package.json" <<EOF
{
  "name": "codex-linux-repack",
  "private": true,
  "version": "$APP_VERSION",
  "main": "bootstrap.js",
  "scripts": {
    "dist": "electron-builder --linux dir AppImage --publish never"
  },
  "devDependencies": {
    "electron": "$ELECTRON_VERSION",
    "electron-builder": "^26.8.1"
  },
  "build": {
    "appId": "com.openai.codex.port",
    "productName": "$APP_PRODUCT_NAME",
    "directories": { "output": "dist" },
    "extraResources": [
      { "from": "resources/app.asar", "to": "app.asar" },
      { "from": "resources/app.asar.unpacked", "to": "app.asar.unpacked" },
      { "from": "resources/codex", "to": "codex" }
    ],
    "files": ["bootstrap.js"],
    "asar": true,
    "asarUnpack": ["**/*.node", "**/*.so"],
    "linux": {
      "target": ["dir", "AppImage"],
      "category": "Development",
      "executableName": "$APP_EXECUTABLE_NAME",
      "artifactName": "\${productName}-\${version}-\${arch}.\${ext}"
    }
  }
}
EOF

cd "$BUILDER_DIR"
"$PNPM_BIN" install
"$PNPM_BIN" run dist

echo
echo "=== [8] Finalize artifacts ==="

APPIMAGE_PATH="$(find "$BUILDER_DIR/dist" -maxdepth 1 -type f -name '*.AppImage' | head -n 1 || true)"
if [ -z "$APPIMAGE_PATH" ]; then
  echo "ERROR: AppImage artifact not found in $BUILDER_DIR/dist" >&2
  exit 1
fi

ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT_APP_DIR/artifacts}"
mkdir -p "$ARTIFACT_DIR"
DMG_SHA_SHORT="$(sha256sum "$DMG_PATH" | awk '{print $1}' | cut -c1-12)"
RENAMED_APPIMAGE="$ARTIFACT_DIR/codex-linux-repack-${APP_VERSION}-${DMG_SHA_SHORT}-x86_64.AppImage"
cp -f "$APPIMAGE_PATH" "$RENAMED_APPIMAGE"
chmod +x "$RENAMED_APPIMAGE"

echo
echo "Done."
echo "Artifacts: $BUILDER_DIR/dist"
echo "Release artifact: $RENAMED_APPIMAGE"
echo "APP_VERSION=$APP_VERSION"
echo "APPIMAGE_PATH=$RENAMED_APPIMAGE"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    printf 'app_version=%s\n' "$APP_VERSION"
    printf 'appimage_path=%s\n' "$RENAMED_APPIMAGE"
    printf 'dmg_sha_short=%s\n' "$DMG_SHA_SHORT"
  } >> "$GITHUB_OUTPUT"
fi
echo "Run:"
echo "  chmod +x \"$BUILDER_DIR\"/dist/*.AppImage"
echo "  \"$BUILDER_DIR\"/dist/*.AppImage"
