#!/usr/bin/env bash
# layout-check.sh — V2-2.4b (contract V2-1.11 §5.3), on top of `canvas-rects`. Reached via
# `maude design layout-check` (DDR-062), never a raw bin path. Read-only — prints, writes nothing.
#
# Usage:
#   layout-check.sh [<canvas>] [--rects <file>] [--root <project>] [--json]
#
# Artboards that overlap on the canvas (error) and elements that spill out of their artboard,
# which clips them (warning). Elements are measured only when a studio is up (canvas-rects' live
# lane); otherwise artboards only. <canvas> defaults to the active one (_active.json).
# Exit 0 no errors · 1 errors · 2 usage.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v bun >/dev/null 2>&1; then
  echo "layout-check.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi
case "$1" in
  --help|-h) sed -n '2,13p' "$0" | sed -E 's/^# ?//' | sed 's/^layout-check.sh/maude design layout-check/'; exit 0 ;;
esac
exec bun run "$SCRIPT_DIR/_layout-check.mjs" "$@"
