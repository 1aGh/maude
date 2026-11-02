#!/usr/bin/env bash
# sync.sh — Sync status and Resync from a terminal (S11.11; Menu › Diagnostics › Sync / Advanced › Resync now).
# Reached via `maude design sync` (DDR-062), never a raw bin path.
#
# Usage:
#   sync.sh status [--json]
#   sync.sh resync [--no-wait] [--json]
#
# Asks the project's running studio. Exit 0 ok · 1 the studio refused / sync is not running ·
# 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "sync.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_sync.mjs" "$@"
