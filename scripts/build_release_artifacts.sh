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

tar_gz_path="$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name '*.tar.gz' | sort | tail -n 1 || true)"

appimage_name="$(basename "$appimage_path")"
appimage_sha256="$(sha256sum "$appimage_path" | awk '{print $1}')"

sha_file="$OUTPUT_DIR/sha256sums.txt"
{
  printf '%s  %s\n' "$appimage_sha256" "$appimage_name"
  if [[ -n "$tar_gz_path" ]]; then
    tar_gz_name="$(basename "$tar_gz_path")"
    tar_gz_sha256="$(sha256sum "$tar_gz_path" | awk '{print $1}')"
    printf '%s  %s\n' "$tar_gz_sha256" "$tar_gz_name"
  fi
} > "$sha_file"

printf 'appimage_path=%s\n' "$appimage_path"
printf 'appimage_name=%s\n' "$appimage_name"
printf 'appimage_sha256=%s\n' "$appimage_sha256"
if [[ -n "$tar_gz_path" ]]; then
  printf 'tar_gz_path=%s\n' "$tar_gz_path"
fi
printf 'sha_file=%s\n' "$sha_file"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'appimage_path=%s\n' "$appimage_path"
    printf 'appimage_name=%s\n' "$appimage_name"
    printf 'appimage_sha256=%s\n' "$appimage_sha256"
    if [[ -n "$tar_gz_path" ]]; then
      printf 'tar_gz_path=%s\n' "$tar_gz_path"
    fi
    printf 'sha_file=%s\n' "$sha_file"
  } >> "$GITHUB_OUTPUT"
fi
