#!/usr/bin/env bash
# place.sh — V2-2.4b (contract V2-1.11 §5.3), on top of `canvas-rects`. Reached via
# `maude design place` (DDR-062), never a raw bin path. Read-only — prints, writes nothing.
#
# Usage:
#   place.sh [<canvas>] --near <id> --size WxH [--gap 80] [--rects <file>] [--root <project>] [--json]
#
# A free WxH spot next to an artboard or element (`--near`), clear of every artboard by --gap px:
# right of it, below, left, above, then the nearest free spot around it. <canvas> defaults to the
# active one (_active.json). --rects reads a manifest `maude design canvas-rects` printed.
# Exit 0 (prints x y w h) · 1 unknown id · 2 usage.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v bun >/dev/null 2>&1; then
  echo "place.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi
case "$1" in
  --help|-h) sed -n '2,13p' "$0" | sed -E 's/^# ?//' | sed 's/^place.sh/maude design place/'; exit 0 ;;
esac
exec bun run "$SCRIPT_DIR/_place.mjs" "$@"
