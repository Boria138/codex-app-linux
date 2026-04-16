#!/usr/bin/env bash
# =============================================================================
# repack.sh — Codex macOS DMG → Linux AppImage
# Версия: 5.0 (правильная установка зависимостей нативных модулей)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
BLU='\033[0;34m'
RST='\033[0m'

log_step() { echo -e "\n${BLU}===${RST} ${GRN}$*${RST} ${BLU}===${RST}"; }
log_info() { echo -e "  ${GRN}•${RST} $*"; }
log_warn() { echo -e "  ${YEL}⚠${RST}  $*"; }
log_err()  { echo -e "  ${RED}✗${RST}  $*" >&2; }
die()      { log_err "$*"; exit 1; }

CLEANUP_DIRS=()
cleanup() {
  local code=$?
  if [ $code -ne 0 ] && [ ${#CLEANUP_DIRS[@]} -gt 0 ]; then
    log_warn "Выход с ошибкой (код $code). Временные файлы сохранены:"
    for d in "${CLEANUP_DIRS[@]}"; do log_warn "  $d"; done
  fi
}
trap cleanup EXIT

# =============================================================================
# [0] Проверка системы
# =============================================================================
log_step "[0] Проверка системы"

ARCH="$(uname -m 2>/dev/null || echo unknown)"
[ "$ARCH" = "x86_64" ] || die "Только x86_64 поддерживается (обнаружено: $ARCH)"

for cmd in curl 7z node npm npx python3; do
  command -v "$cmd" >/dev/null 2>&1 || die "Отсутствует команда: $cmd"
done

log_info "Проверка инструментов сборки..."
MISSING=()
command -v g++ >/dev/null 2>&1 || MISSING+=("g++")
command -v make >/dev/null 2>&1 || MISSING+=("make")
if [ ${#MISSING[@]} -gt 0 ]; then
  log_err "Отсутствуют: ${MISSING[*]}"
  if [ -f /etc/debian_version ]; then
    log_err "Установите: sudo apt-get install -y build-essential python3-dev libsqlite3-dev pkg-config libx11-dev libxkbfile-dev p7zip-full"
  elif grep -q "ALT\|Fedora\|CentOS" /etc/os-release 2>/dev/null; then
    log_err "Установите: sudo yum install -y gcc-c++ make python3-devel sqlite-devel pkgconf-pkg-config libX11-devel libxkbfile-devel p7zip"
  fi
  die "Сборка невозможна"
fi
log_info "✓ Все инструменты найдены"

NODE_VER="$(node --version)"
NPM_VER="$(npm --version)"
log_info "node $NODE_VER  /  npm $NPM_VER"

# =============================================================================
# [1] Скачивание Codex.dmg
# =============================================================================
log_step "[1] Скачивание Codex.dmg"

UPSTREAM_URL="${UPSTREAM_URL:-https://persistent.oaistatic.com/codex-app-prod/Codex.dmg}"
CODEX_CLI_ARCHIVE_NAME="${CODEX_CLI_ARCHIVE_NAME:-codex-cli-linux.tar.gz}"
CODEX_CLI_BIN_NAME="${CODEX_CLI_BIN_NAME:-codex-x86_64-unknown-linux-gnu}"
CODEX_CLI_URL="${CODEX_CLI_URL:-https://github.com/openai/codex/releases/latest/download/${CODEX_CLI_BIN_NAME}.tar.gz}"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$HOME/Downloads/codex-macos}"
mkdir -p "$DOWNLOAD_DIR"
DMG_PATH="${DMG_PATH:-$DOWNLOAD_DIR/Codex.dmg}"
CODEX_CLI_ARCHIVE_PATH="${CODEX_CLI_ARCHIVE_PATH:-$DOWNLOAD_DIR/$CODEX_CLI_ARCHIVE_NAME}"

if [ "${FORCE_DOWNLOAD:-0}" = "1" ] || [ ! -f "$DMG_PATH" ]; then
  log_info "Загружаем: $UPSTREAM_URL"
  tmp="${DMG_PATH}.tmp"; rm -f "$tmp"
  curl -fL --retry 3 --progress-bar "$UPSTREAM_URL" -o "$tmp"
  mv "$tmp" "$DMG_PATH"
  log_info "Сохранено: $DMG_PATH"
else
  log_info "Используем кэш: $DMG_PATH"
fi

if [ "${FORCE_DOWNLOAD:-0}" = "1" ] || [ ! -f "$CODEX_CLI_ARCHIVE_PATH" ]; then
  log_info "Загружаем Linux codex CLI: $CODEX_CLI_URL"
  tmp="${CODEX_CLI_ARCHIVE_PATH}.tmp"; rm -f "$tmp"
  curl -fL --retry 3 --progress-bar "$CODEX_CLI_URL" -o "$tmp"
  mv "$tmp" "$CODEX_CLI_ARCHIVE_PATH"
  log_info "Сохранено: $CODEX_CLI_ARCHIVE_PATH"
else
  log_info "Используем кэш Linux codex CLI: $CODEX_CLI_ARCHIVE_PATH"
fi

# =============================================================================
# [2] Подготовка директорий
# =============================================================================
log_step "[2] Подготовка рабочих директорий"

ROOT_APP_DIR="$HOME/apps/codex-port"
mkdir -p "$ROOT_APP_DIR"
CLEANUP_DIRS+=("$ROOT_APP_DIR/dmg_extracted" "$ROOT_APP_DIR/app_extracted" "$ROOT_APP_DIR/codex-cli")
rm -rf "$ROOT_APP_DIR/dmg_extracted" "$ROOT_APP_DIR/app_extracted" "$ROOT_APP_DIR/app.asar" "$ROOT_APP_DIR/app.asar.unpacked" "$ROOT_APP_DIR/codex-cli"
log_info "Рабочий каталог: $ROOT_APP_DIR"

# =============================================================================
# [3] Извлечение DMG и app-бандла
# =============================================================================
log_step "[3] Извлечение DMG и app-бандла"

cd "$ROOT_APP_DIR"
log_info "Распаковываем DMG..."
7z x -y -aoa "$DMG_PATH" -o./dmg_extracted > /dev/null

APP_BUNDLE_DIR="$(find ./dmg_extracted -maxdepth 6 -type d -name '*.app' | head -n1)"
[ -n "$APP_BUNDLE_DIR" ] || die ".app-бандл не найден"
APP_BUNDLE_DIR="$(realpath "$APP_BUNDLE_DIR")"
log_info "Найден бандл: $APP_BUNDLE_DIR"

APP_ASAR_PATH="$APP_BUNDLE_DIR/Contents/Resources/app.asar"
APP_ICON_PATH="$APP_BUNDLE_DIR/Contents/Resources/electron.icns"
[ -f "$APP_ASAR_PATH" ] || die "app.asar не найден"
[ -f "$APP_ICON_PATH" ] || die "Иконка не найдена"

mkdir -p "$ROOT_APP_DIR/codex-cli"
tar -xzf "$CODEX_CLI_ARCHIVE_PATH" -C "$ROOT_APP_DIR/codex-cli"

CODEX_BIN_PATH="${CODEX_BIN_PATH:-$ROOT_APP_DIR/codex-cli/$CODEX_CLI_BIN_NAME}"
[ -f "$CODEX_BIN_PATH" ] || die "Linux codex CLI не найден в архиве: $CODEX_BIN_PATH"
[ -x "$CODEX_BIN_PATH" ] || die "codex CLI не исполняемый: $CODEX_BIN_PATH"
log_info "Используем Linux codex CLI: $CODEX_BIN_PATH"

APP_VERSION="$(python3 - "$APP_BUNDLE_DIR/Contents/Info.plist" <<'PY'
import plistlib,re,sys
with open(sys.argv[1],"rb") as f: p=plistlib.load(f)
v=p.get("CFBundleShortVersionString") or p.get("CFBundleVersion") or "0.0.0"
print(re.sub(r"[^0-9A-Za-z._-]","",v.replace("-",".")))
PY
)"
APP_VERSION="${APP_VERSION:-0.0.0}"
log_info "Версия приложения: $APP_VERSION"

log_info "Извлекаем app.asar..."
npx --yes asar extract "$APP_ASAR_PATH" "$ROOT_APP_DIR/app_extracted"
[ -d "$APP_BUNDLE_DIR/Contents/Resources/app.asar.unpacked" ] && cp -a "$APP_BUNDLE_DIR/Contents/Resources/app.asar.unpacked" "$ROOT_APP_DIR/"
[ -f "$ROOT_APP_DIR/app_extracted/package.json" ] || die "package.json не найден"

log_info "Удаляем macOS-артефакты..."
rm -rf "$ROOT_APP_DIR/app_extracted/node_modules/sparkle-darwin" 2>/dev/null || true
find "$ROOT_APP_DIR/app_extracted" -type f \( -name "*.dylib" -o -name "sparkle.node" \) -delete 2>/dev/null || true

# =============================================================================
# [4] Версия Electron
# =============================================================================
log_step "[4] Определение версии Electron"

ELECTRON_VERSION=""
ELECTRON_PLIST="$(find ./dmg_extracted -path "*/Electron Framework.framework/Versions/A/Resources/Info.plist" | head -n1)"
if [ -n "$ELECTRON_PLIST" ] && [ -f "$ELECTRON_PLIST" ]; then
  ELECTRON_VERSION="$(python3 - "$ELECTRON_PLIST" <<'PY'
import plistlib,re,sys
with open(sys.argv[1],"rb") as f: p=plistlib.load(f)
print(re.sub(r"^[^0-9]+","",str(p.get("CFBundleVersion") or "").strip()))
PY
)"
fi
[ -z "$ELECTRON_VERSION" ] && ELECTRON_VERSION="$(node -p "try{String(require('$ROOT_APP_DIR/app_extracted/package.json').devDependencies?.electron||'').replace(/^[^0-9]*/,'')}catch(e){''}" 2>/dev/null)" || true
[ -z "$ELECTRON_VERSION" ] && ELECTRON_VERSION="40.0.0" && log_warn "Electron версия не определена, используем $ELECTRON_VERSION" || log_info "Версия Electron: $ELECTRON_VERSION"

# =============================================================================
# [5] Пересборка нативных модулей
# =============================================================================
log_step "[5] Пересборка нативных модулей (electron-rebuild)"

log_info "Подготовка к пересборке нативных модулей..."
BSQL_VERSION="$(node -p "require('$ROOT_APP_DIR/app_extracted/node_modules/better-sqlite3/package.json').version")"
NODE_PTY_VERSION="$(node -p "require('$ROOT_APP_DIR/app_extracted/node_modules/node-pty/package.json').version")"
log_info "better-sqlite3: $BSQL_VERSION"
log_info "node-pty: $NODE_PTY_VERSION"

NATIVE_BUILD_DIR="$ROOT_APP_DIR/native-build"
TARBALL_DIR="$ROOT_APP_DIR/native-tarballs"
CLEANUP_DIRS+=("$NATIVE_BUILD_DIR" "$TARBALL_DIR")
rm -rf "$NATIVE_BUILD_DIR" "$TARBALL_DIR"
mkdir -p "$NATIVE_BUILD_DIR" "$TARBALL_DIR"

BSQL_TGZ="$TARBALL_DIR/better-sqlite3-$BSQL_VERSION.tgz"
NODE_PTY_TGZ="$TARBALL_DIR/node-pty-$NODE_PTY_VERSION.tgz"

log_info "Скачиваем исходники npm..."
curl -fL --retry 3 "https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-$BSQL_VERSION.tgz" -o "$BSQL_TGZ"
curl -fL --retry 3 "https://registry.npmjs.org/node-pty/-/node-pty-$NODE_PTY_VERSION.tgz" -o "$NODE_PTY_TGZ"

cd "$NATIVE_BUILD_DIR"
cat > package.json <<'EOF'
{
  "name": "codex-desktop-native-rebuild",
  "private": true,
  "license": "UNLICENSED"
}
EOF

log_info "Устанавливаем исходные npm-пакеты..."
npm install --ignore-scripts --no-audit --no-fund \
  "$BSQL_TGZ" \
  "$NODE_PTY_TGZ" 2>&1 | sed 's/^/    /'

export npm_config_runtime=electron
export npm_config_target="$ELECTRON_VERSION"
export npm_config_disturl="https://electronjs.org/headers"
export npm_config_build_from_source=true

log_info "electron-rebuild (electron $ELECTRON_VERSION)..."
npx --yes @electron/rebuild -v "$ELECTRON_VERSION" --force 2>&1 | sed 's/^/    /'
unset npm_config_runtime npm_config_target npm_config_disturl npm_config_build_from_source

rm -rf "$ROOT_APP_DIR/app_extracted/node_modules/better-sqlite3"
rm -rf "$ROOT_APP_DIR/app_extracted/node_modules/node-pty"
cp -a "$NATIVE_BUILD_DIR/node_modules/better-sqlite3" "$ROOT_APP_DIR/app_extracted/node_modules/"
cp -a "$NATIVE_BUILD_DIR/node_modules/node-pty" "$ROOT_APP_DIR/app_extracted/node_modules/"

BSQL_NODE="$ROOT_APP_DIR/app_extracted/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
PTY_NODE="$ROOT_APP_DIR/app_extracted/node_modules/node-pty/build/Release/pty.node"
[ -f "$BSQL_NODE" ] || die "better_sqlite3.node не найден после rebuild"
[ -f "$PTY_NODE" ] || die "pty.node не найден после rebuild"
log_info "better_sqlite3.node: OK ($(du -h "$BSQL_NODE" | cut -f1))"
log_info "pty.node: OK ($(du -h "$PTY_NODE" | cut -f1))"

# Проверка зависимостей .node файлов
if command -v ldd >/dev/null 2>&1; then
  log_info "Проверка зависимостей better_sqlite3.node..."
  if ldd "$BSQL_NODE" 2>&1 | grep -q "not found"; then
    log_err "Отсутствуют системные библиотеки:"
    ldd "$BSQL_NODE" 2>&1 | grep "not found" | sed 's/^/    /'
    log_err "Установите: sudo apt-get install -y libsqlite3-dev"
    die "Зависимости better_sqlite3.node не удовлетворены"
  else
    log_info "✓ Зависимости OK"
  fi
fi

# Удаляем тестовые файлы TypeScript чтобы не мешали
find "$ROOT_APP_DIR/app_extracted/node_modules/node-pty" -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -delete 2>/dev/null || true

# =============================================================================
# [6] Перепаковка app.asar
# =============================================================================
log_step "[6] Перепаковка app.asar"

cd "$ROOT_APP_DIR"
REPACKED_ASAR="$ROOT_APP_DIR/app.asar"
rm -rf "$ROOT_APP_DIR/app.asar.unpacked"

log_info "asar pack..."
npx --yes asar pack "$ROOT_APP_DIR/app_extracted" "$REPACKED_ASAR" --unpack "**/*.node"
[ -f "$REPACKED_ASAR" ] || die "app.asar не создан"

log_info "Создаём app.asar.unpacked..."
mkdir -p "$ROOT_APP_DIR/app.asar.unpacked/node_modules"
for dep in better-sqlite3 node-pty; do
  rm -rf "$ROOT_APP_DIR/app.asar.unpacked/node_modules/$dep"
  cp -a "$ROOT_APP_DIR/app_extracted/node_modules/$dep" "$ROOT_APP_DIR/app.asar.unpacked/node_modules/"
done

[ -f "$ROOT_APP_DIR/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ] || die "better_sqlite3.node не в unpacked"
[ -f "$ROOT_APP_DIR/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node" ] || die "pty.node не в unpacked"

# =============================================================================
# [7] Подготовка electron-builder
# =============================================================================
log_step "[7] Подготовка проекта electron-builder"

BUILDER_DIR="$ROOT_APP_DIR/_electron-builder"
CLEANUP_DIRS+=("$BUILDER_DIR")
rm -rf "$BUILDER_DIR"; mkdir -p "$BUILDER_DIR/resources"

APP_PRODUCT_NAME="$(node -p "try{const p=require('$ROOT_APP_DIR/app_extracted/package.json');p.productName||p.name||'Codex'}catch(e){'Codex'}" 2>/dev/null || echo "Codex")"
APP_EXECUTABLE_NAME="codex-app-linux-port"
log_info "productName: $APP_PRODUCT_NAME | executable: $APP_EXECUTABLE_NAME | version: $APP_VERSION"

log_info "Копируем ресурсы..."
cp -a "$REPACKED_ASAR" "$BUILDER_DIR/resources/codex.asar"
cp -a "$CODEX_BIN_PATH" "$BUILDER_DIR/resources/codex"
chmod +x "$BUILDER_DIR/resources/codex"
cp -a "$APP_ICON_PATH" "$BUILDER_DIR/resources/electron.icns"

log_info "Копируем unpacked..."
mkdir -p "$BUILDER_DIR/resources/codex.asar.unpacked/node_modules"
mkdir -p "$BUILDER_DIR/resources/app.asar.unpacked/node_modules"
for dep in better-sqlite3 node-pty; do
  cp -a "$ROOT_APP_DIR/app.asar.unpacked/node_modules/$dep" "$BUILDER_DIR/resources/codex.asar.unpacked/node_modules/"
  cp -a "$ROOT_APP_DIR/app.asar.unpacked/node_modules/$dep" "$BUILDER_DIR/resources/app.asar.unpacked/node_modules/"
done

find "$BUILDER_DIR/resources/codex.asar.unpacked" -name "*.node" -exec chmod 755 {} \;
find "$BUILDER_DIR/resources/app.asar.unpacked" -name "*.node" -exec chmod 755 {} \;

cat > "$BUILDER_DIR/bootstrap.js" <<'BOOTSTRAP'
"use strict";
const path = require("path");
process.env.ELECTRON_FORCE_IS_PACKAGED = "1";
process.env.NODE_ENV = "production";
process.env.CODEX_CLI_PATH = path.join(process.resourcesPath, "codex");
require(path.join(process.resourcesPath, "codex.asar"));
BOOTSTRAP

# !!! ИСПРАВЛЕНО: package.json с правильными настройками !!!
cat > "$BUILDER_DIR/package.json" <<EOF
{
  "name": "codex-linux-repack",
  "private": true,
  "version": "$APP_VERSION",
  "main": "bootstrap.js",
  "description": "Codex Linux port",
  "author": "OpenAI (ported)",
  "scripts": { "dist": "electron-builder --linux dir AppImage tar.gz --publish never" },
  "devDependencies": {
    "electron": "$ELECTRON_VERSION",
    "electron-builder": "^26.8.1"
  },
  "build": {
    "appId": "com.openai.codex.port",
    "productName": "$APP_PRODUCT_NAME",
    "directories": { "output": "dist" },
    "files": ["bootstrap.js"],
    "extraResources": [
      { "from": "resources/codex.asar", "to": "codex.asar" },
      { "from": "resources/codex.asar.unpacked", "to": "codex.asar.unpacked", "filter": ["**/*"] },
      { "from": "resources/app.asar.unpacked", "to": "app.asar.unpacked", "filter": ["**/*"] },
      { "from": "resources/codex", "to": "codex" },
      { "from": "resources/electron.icns", "to": "electron.icns" }
    ],
    "asar": true,
    "npmRebuild": false,
    "nodeGypRebuild": false,
    "linux": {
      "target": ["dir", "AppImage", "tar.gz"],
      "category": "Development",
      "icon": "resources/electron.icns",
      "executableName": "$APP_EXECUTABLE_NAME",
      "artifactName": "\${productName}-\${version}-\${arch}.\${ext}"
    }
  }
}
EOF

# =============================================================================
# [8] Сборка
# =============================================================================
log_step "[8] Сборка через electron-builder"

cd "$BUILDER_DIR"
log_info "npm install..."

# Тихий режим npm
export NPM_CONFIG_LOGLEVEL=error
export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false

npm install --ignore-scripts --no-audit --no-fund 2>&1 | grep -v "^npm warn" | grep -v "npm error missing:" | sed '/^$/d' | sed 's/^/    /' || true

log_info "electron-builder..."
npx --no-install electron-builder --linux dir --publish never 2>&1 | grep -v "collector stderr" | grep -v "npm error missing:" | sed '/^$/d' | sed 's/^/  /'

LINUX_UNPACKED_DIR="$BUILDER_DIR/dist/linux-unpacked"
[ -d "$LINUX_UNPACKED_DIR/resources" ] || die "linux-unpacked/resources не найден"

rm -rf "$LINUX_UNPACKED_DIR/resources/codex.asar.unpacked"
rm -rf "$LINUX_UNPACKED_DIR/resources/app.asar.unpacked"
cp -a "$BUILDER_DIR/resources/codex.asar.unpacked" "$LINUX_UNPACKED_DIR/resources/"
cp -a "$BUILDER_DIR/resources/app.asar.unpacked" "$LINUX_UNPACKED_DIR/resources/"

UNPACKED_BSQL="$LINUX_UNPACKED_DIR/resources/codex.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
[ -f "$UNPACKED_BSQL" ] || die "better_sqlite3.node не найден в linux-unpacked"
UNPACKED_APP_BSQL="$LINUX_UNPACKED_DIR/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
[ -f "$UNPACKED_APP_BSQL" ] || die "better_sqlite3.node не найден в app.asar.unpacked"

log_info "Собираем AppImage и tar.gz из prepackaged linux-unpacked..."
npx --no-install electron-builder --linux AppImage tar.gz --publish never --prepackaged "$LINUX_UNPACKED_DIR" 2>&1 | grep -v "collector stderr" | grep -v "npm error missing:" | sed '/^$/d' | sed 's/^/  /'

# =============================================================================
# [9] Финализация
# =============================================================================
log_step "[9] Финализация"

APPIMAGE_PATH="$(find "$BUILDER_DIR/dist" -maxdepth 1 -type f -name '*.AppImage' | head -n1 || true)"
[ -n "$APPIMAGE_PATH" ] || die "AppImage не найден"
TAR_GZ_PATH="$(find "$BUILDER_DIR/dist" -maxdepth 1 -type f -name '*.tar.gz' | head -n1 || true)"

ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT_APP_DIR/artifacts}"
mkdir -p "$ARTIFACT_DIR"
RENAMED_APPIMAGE="$ARTIFACT_DIR/codex-linux-repack-${APP_VERSION}-x86_64.AppImage"
cp -f "$APPIMAGE_PATH" "$RENAMED_APPIMAGE"
chmod +x "$RENAMED_APPIMAGE"

if [[ -n "$TAR_GZ_PATH" ]]; then
  RENAMED_TAR_GZ="$ARTIFACT_DIR/codex-linux-repack-${APP_VERSION}-x86_64.tar.gz"
  cp -f "$TAR_GZ_PATH" "$RENAMED_TAR_GZ"
fi

echo -e "\n${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
echo -e "${GRN}  ✓ Готово!${RST}"
echo -e "${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
echo -e "  Версия   : ${BLU}$APP_VERSION${RST}"
echo -e "  Electron : ${BLU}$ELECTRON_VERSION${RST}"
echo -e "  AppImage : ${BLU}$RENAMED_APPIMAGE${RST}"
if [[ -n "${RENAMED_TAR_GZ:-}" ]]; then
  echo -e "  tar.gz   : ${BLU}$RENAMED_TAR_GZ${RST}"
fi
echo -e "\n  Запуск: ${YEL}$RENAMED_APPIMAGE${RST}\n"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'app_version=%s\n' "$APP_VERSION"
    printf 'appimage_path=%s\n' "$RENAMED_APPIMAGE"
    if [[ -n "${RENAMED_TAR_GZ:-}" ]]; then
      printf 'tar_gz_path=%s\n' "$RENAMED_TAR_GZ"
    fi
  } >> "$GITHUB_OUTPUT"
fi
