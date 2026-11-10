#!/usr/bin/env bash
# canvas-move.sh — `maude design canvas-move` (fix-bulk W1 follow-up). Reached via `maude design
# canvas-move` (DDR-062), never a raw bin path. The studio's own rename / move (POST /_api/fs-move),
# sent with the studio's key — see _canvas-file.mjs. Exit 0 ok · 1 refused · 2 usage · 3 no studio.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "canvas-move.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_canvas-file.mjs" move "$@"
