#!/usr/bin/env bash
# annotate.sh — thin wrapper around annotate.mjs (the AI annotation WRITE
# verb). Runs under Bun, not node: the verb imports the TypeScript element
# registry (annotations/ai-write.ts — DDR-242) so it can never write an
# element the canvas would not accept.
# Reached via `maude design annotate` (DDR-062), never a raw bin path.
#
# Usage:
#   annotate.sh <rel-path> [--ops <file|->] [--flow <file|->] [--board <file|->]
#               [--canvas-state <path>] [--root <repo>] [--dry-run]
#   (see annotate.mjs --help for the full contract)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v bun >/dev/null 2>&1; then
  echo "annotate: bun is required (the verb imports the canonical TS annotation model). Install: https://bun.sh" >&2
  exit 1
fi
exec bun "$SCRIPT_DIR/annotate.mjs" "$@"
