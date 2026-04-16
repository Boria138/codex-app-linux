#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://persistent.oaistatic.com/codex-app-prod/Codex.dmg}"
DMG_PATH="${DMG_PATH:-Codex.dmg}"
STATE_FILE="${STATE_FILE:-upstream.sha256}"

out_file="${GITHUB_OUTPUT:-}"

tmp_dmg="${DMG_PATH}.tmp"
rm -f "$tmp_dmg"
curl -fL --retry 3 --retry-delay 2 "$UPSTREAM_URL" -o "$tmp_dmg"
mv "$tmp_dmg" "$DMG_PATH"

upstream_sha256="$(sha256sum "$DMG_PATH" | awk '{print $1}')"

previous_sha256=""
if [[ -f "$STATE_FILE" ]]; then
  previous_sha256="$(tr -d '[:space:]' < "$STATE_FILE")"
fi

changed="false"
if [[ "$upstream_sha256" != "$previous_sha256" ]]; then
  changed="true"
fi

extract_plist_value() {
  local key="$1"
  7z e -so "$DMG_PATH" 'Codex Installer/Codex.app/Contents/Info.plist' \
    | awk -v key="$key" '
      $0 ~ "<key>" key "</key>" {
        getline
        if (match($0, /<string>([^<]+)<\/string>/, m)) {
          print m[1]
          exit
        }
      }
    '
}

app_version="$(extract_plist_value "CFBundleShortVersionString" || true)"
if [[ -n "$app_version" ]]; then
  app_version="$(printf '%s' "$app_version" | tr '-' '.' | tr -cd '[:alnum:]._-')"
fi

printf 'changed=%s\n' "$changed"
printf 'upstream_sha256=%s\n' "$upstream_sha256"
printf 'app_version=%s\n' "$app_version"
printf 'dmg_path=%s\n' "$DMG_PATH"

if [[ -n "$out_file" ]]; then
  {
    printf 'changed=%s\n' "$changed"
    printf 'upstream_sha256=%s\n' "$upstream_sha256"
    printf 'app_version=%s\n' "$app_version"
    printf 'dmg_path=%s\n' "$DMG_PATH"
  } >> "$out_file"
fi
