#!/usr/bin/env bash
# read-annotations.sh — thin wrapper around read-annotations.mjs (the AI read
# verb over the v2 board). Reached via `maude design read-annotations`
# (DDR-062), never a raw bin path.
#
# Usage:
#   read-annotations.sh <rel-path> [--in <id>] [--type <t,…>] [--rects <path>] [--graph] [--full]
#   (see read-annotations.mjs --help for the full contract)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# DDR-242 — the v2 board is read through the TS model: prefer bun (bundled with
# the app), fall back to node (≥ 22.18 strips TS types natively).
if command -v bun >/dev/null 2>&1; then
  exec bun "$SCRIPT_DIR/read-annotations.mjs" "$@"
fi
exec node "$SCRIPT_DIR/read-annotations.mjs" "$@"
