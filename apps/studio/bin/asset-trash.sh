#!/usr/bin/env bash
# asset-trash.sh — `maude design asset-trash` (fix-bulk 2026-11-10 follow-up). Reached via `maude design
# asset-trash` (DDR-062), never a raw bin path. The Assets panel's Move to trash (POST /_api/assets/trash),
# sent with the studio's key — see _asset-file.mjs. Exit 0 ok · 1 refused · 2 usage · 3 no studio.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "asset-trash.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_asset-file.mjs" trash "$@"
