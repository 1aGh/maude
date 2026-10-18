#!/usr/bin/env bash
# trash.sh — the shared Trash of this project (S1.17, contract V2-1.11 §5.3, S1-trash.md).
# Reached via `maude design trash` (DDR-062), never a raw bin path.
#
# Usage:
#   trash.sh list [--json]                          # what is in the Trash, newest first   (read-only)
#   trash.sh restore <id | canvas path>             # bring one item back                  (project)
#   trash.sh clear [--item <id>]... [--yes]         # delete for good — OWNER only, asks first
#
# `clear` is the project owner's, at a terminal: the studio refuses every other role, and the
# registry action `trash.clear` is human-only (decision:maude/v2-lead-trash-clear-human-only).
#
# Asks the project's running studio. Exit 0 ok · 1 not found / refused / not available · 2 usage ·
# 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "trash.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_trash.mjs" "$@"
