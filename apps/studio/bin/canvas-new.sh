#!/usr/bin/env bash
# canvas-new.sh — `maude design canvas-new` (fix-bulk W1 follow-up). Reached via `maude design
# canvas-new` (DDR-062), never a raw bin path. The studio's own create (POST /_api/canvas), sent with
# the studio's key — see _canvas-file.mjs. Exit 0 ok · 1 refused · 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "canvas-new.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_canvas-file.mjs" new "$@"
