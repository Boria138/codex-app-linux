#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$REPO_DIR/dist/release}"

mkdir -p "$OUTPUT_DIR"

(
  cd "$REPO_DIR"
  ARTIFACT_DIR="$OUTPUT_DIR" bash ./repack.sh
)

appimage_path="$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name '*.AppImage' | sort | tail -n 1 || true)"
if [[ -z "$appimage_path" ]]; then
  echo "No AppImage produced in $OUTPUT_DIR" >&2
  exit 1
fi

appimage_name="$(basename "$appimage_path")"
appimage_sha256="$(sha256sum "$appimage_path" | awk '{print $1}')"

sha_file="$OUTPUT_DIR/sha256sums.txt"
printf '%s  %s\n' "$appimage_sha256" "$appimage_name" > "$sha_file"

printf 'appimage_path=%s\n' "$appimage_path"
printf 'appimage_name=%s\n' "$appimage_name"
printf 'appimage_sha256=%s\n' "$appimage_sha256"
printf 'sha_file=%s\n' "$sha_file"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'appimage_path=%s\n' "$appimage_path"
    printf 'appimage_name=%s\n' "$appimage_name"
    printf 'appimage_sha256=%s\n' "$appimage_sha256"
    printf 'sha_file=%s\n' "$sha_file"
  } >> "$GITHUB_OUTPUT"
fi
