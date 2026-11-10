#!/usr/bin/env bash
# asset-rename.sh — `maude design asset-rename` (fix-bulk 2026-11-10 follow-up). Reached via `maude design
# asset-rename` (DDR-062), never a raw bin path. The Assets panel's Rename… (POST /_api/assets/rename),
# sent with the studio's key — see _asset-file.mjs. Exit 0 ok · 1 refused · 2 usage · 3 no studio.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "asset-rename.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_asset-file.mjs" rename "$@"
