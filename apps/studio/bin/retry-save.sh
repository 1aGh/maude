#!/usr/bin/env bash
# retry-save.sh — `maude design retry-save` (fix-bulk 2026-11-10 follow-up). Reached via `maude design
# retry-save` (DDR-062), never a raw bin path. Retry on the saves a full disk held (POST
# /_api/diagnostics/disk-retry), sent with the studio's key — see _retry-save.mjs.
# Exit 0 every held save landed · 1 some still held / refused · 2 usage · 3 no studio.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "retry-save.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_retry-save.mjs" "$@"
