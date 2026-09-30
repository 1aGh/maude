#!/usr/bin/env bash
# read-annotations.sh — thin wrapper around read-annotations.mjs (the headless
# SVG → JSON annotation reader). Reached via `maude design read-annotations`
# (DDR-062), never a raw bin path. The reader is zero-dep Node, so we exec under
# `node` (always present — maude itself runs on Node), not Bun.
#
# Usage:
#   read-annotations.sh <rel-path> [--root <repo>] [--canvas-state <path>]
#   (see read-annotations.mjs --help for the full contract)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# DDR-242 — the v2 board is read through the TS model: prefer bun (bundled with
# the app), fall back to node (≥ 22.18 strips TS types natively).
if command -v bun >/dev/null 2>&1; then
  exec bun "$SCRIPT_DIR/read-annotations.mjs" "$@"
fi
exec node "$SCRIPT_DIR/read-annotations.mjs" "$@"
