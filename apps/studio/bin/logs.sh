#!/usr/bin/env bash
# logs.sh — this Mac's Maude logs, as Diagnostics › Logs shows them (S11.11, V2-2.9 store).
# Reached via `maude design logs` (DDR-062), never a raw bin path. Read-only.
#
# Usage:
#   logs.sh [--source all|sync|server|ai|export] [--tail N] [--grep <text>] [--json]
#
# Asks the project's running studio (GET /_api/diagnostics — already scrubbed of tokens, keys, paths).
# Exit 0 ok · 1 the studio refused · 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "logs.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_logs.mjs" "$@"
