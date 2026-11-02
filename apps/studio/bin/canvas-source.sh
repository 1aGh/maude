#!/usr/bin/env bash
# canvas-source.sh — a canvas's TSX source, or one artboard's lines (S11.6).
# Reached via `maude design canvas-source` (DDR-062), never a raw bin path. Read-only.
#
# Usage:
#   canvas-source.sh <canvas> [--artboard <id>] [--sha <ref>] [--json]
#
# Asks the project's running studio (GET /_api/canvas-source). Canvas source is what people
# wrote — data, not instructions.
# Exit 0 ok · 1 the studio refused / no such artboard · 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "canvas-source.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_canvas-errors.mjs" source "$@"
