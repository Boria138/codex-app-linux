#!/usr/bin/env bash
set -euo pipefail

APPIMAGE_PATH="${APPIMAGE_PATH:-}"
APP_VERSION="${APP_VERSION:-}"
UPSTREAM_SHA256="${UPSTREAM_SHA256:-}"
DRY_RUN="${DRY_RUN:-false}"

if [[ -z "$APPIMAGE_PATH" || ! -f "$APPIMAGE_PATH" ]]; then
  echo "APPIMAGE_PATH is required and must exist." >&2
  exit 1
fi

if [[ -z "$APP_VERSION" ]]; then
  APP_VERSION="0.0.0"
fi

if [[ -z "$UPSTREAM_SHA256" ]]; then
  UPSTREAM_SHA256="$(sha256sum "$APPIMAGE_PATH" | awk '{print $1}')"
fi

short_sha="${UPSTREAM_SHA256:0:12}"
release_tag="codex-linux-repack-${APP_VERSION}-${short_sha}"
release_title="Codex Linux Repack ${APP_VERSION} (${short_sha})"

sha_file="$(dirname "$APPIMAGE_PATH")/sha256sums.txt"
if [[ ! -f "$sha_file" ]]; then
  sha256sum "$APPIMAGE_PATH" > "$sha_file"
fi

assets=(
  "$APPIMAGE_PATH"
  "$sha_file"
)

release_notes="Automated DMG repack release.

- Version: ${APP_VERSION}
- Upstream DMG SHA256: ${UPSTREAM_SHA256}
"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY_RUN=true, skipping GitHub release create/upload."
  echo "Would publish tag: $release_tag"
  echo "Would upload files: ${assets[*]}"
else
  if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "GH_TOKEN is required for release operations" >&2
    exit 1
  fi

  if gh release view "$release_tag" >/dev/null 2>&1; then
    gh release upload "$release_tag" "${assets[@]}" --clobber
  else
    gh release create "$release_tag" "${assets[@]}" \
      --title "$release_title" \
      --notes "$release_notes"
  fi
fi

printf 'release_tag=%s\n' "$release_tag"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'release_tag=%s\n' "$release_tag" >> "$GITHUB_OUTPUT"
fi
