#!/usr/bin/env bash
# footage.sh — `maude design footage show|save` (fix-bulk 2026-11-10 follow-up). Reached via `maude design
# footage` (DDR-062), never a raw bin path. A clip's footage analysis or a cut's EDL (GET / PUT
# /_api/footage), sent with the studio's key — see _footage.mjs. Exit 0 ok · 1 refused · 2 usage · 3 no studio.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "footage.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_footage.mjs" "$@"
