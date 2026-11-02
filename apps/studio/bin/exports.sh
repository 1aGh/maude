#!/usr/bin/env bash
# exports.sh — the Exports panel from a terminal (V2-2.4b, contract V2-1.11 §5.3, S8).
# Reached via `maude design exports` (DDR-062), never a raw bin path.
#
# Usage:
#   exports.sh list [--json]                                   # recent exports (read-only)
#   exports.sh again <id|index> [--out <file|folder/>] [--no-wait] [--json]
#
# `again` re-submits the entry exactly as the Export sheet's "Export again" row does, waits for the
# job and writes the file inside the project (--out is confined to the project / temp dir).
# Exit 0 ok · 1 not found / the export failed · 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "exports.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_exports.mjs" "$@"
