#!/usr/bin/env sh
set -eu

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

AUTHOR_EMAIL="${AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
AUTHOR_NAME="${AUTHOR_NAME:-github-actions[bot]}"
STATE_FILE="${STATE_FILE:-upstream.sha256}"
BRANCH="${BRANCH:-main}"
MESSAGE="${MESSAGE:-chore: update upstream sha256 ${timestamp}}"

[ -z "${GITHUB_TOKEN:-}" ] && {
  echo "Missing GITHUB_TOKEN." >&2
  exit 1
}
[ -z "${GITHUB_ACTOR:-}" ] && {
  echo "Missing GITHUB_ACTOR." >&2
  exit 1
}
[ -z "${GITHUB_REPOSITORY:-}" ] && {
  echo "Missing GITHUB_REPOSITORY." >&2
  exit 1
}

server_url="${GITHUB_SERVER_URL:-https://github.com}"
remote_repo="https://${GITHUB_ACTOR}:${GITHUB_TOKEN}@${server_url#https://}/${GITHUB_REPOSITORY}.git"

workdir="${GITHUB_WORKSPACE:-.}"
cd "${workdir}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Current directory is not a git repository: ${workdir}" >&2
  exit 1
}

git config --local user.email "${AUTHOR_EMAIL}"
git config --local user.name "${AUTHOR_NAME}"

git add "${STATE_FILE}"
git commit -m "${MESSAGE}" || exit 0
git push "${remote_repo}" HEAD:"${BRANCH}"
