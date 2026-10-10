#!/usr/bin/env bash
# /design:handoff CLI wrapper — emits <Slug>.registry.json sidecar next to a
# canvas TSX. Thin shell-out so /design:handoff doesn't have to spin up Bun
# from the orchestrator side.
#
# Usage:
#   bin/handoff.sh <canvas-abs-path> [designRoot]
#
# Output (stdout, line 1): JSON {"dest":"...","files":N,"deps":M}
# Exit code 0 on success, 2 on any failure (with reason on stderr).

set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  # Contract V2-1.11 §5.7 rule 6: every verb a `cli` action names exits 0 on --help.
  echo "usage: maude design handoff <canvas-abs-path> [designRoot]"
  echo "  Emit <Slug>.registry.json (a shadcn registry handoff) next to the canvas."
  exit 0
fi
if [ $# -lt 1 ]; then
  echo "usage: handoff.sh <canvas-abs-path> [designRoot]" >&2
  exit 2
fi

CANVAS="$1"
DESIGN_ROOT="${2:-}"

DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "$DESIGN_ROOT" ]; then
  exec bun run "$DIR/handoff.ts" --emit "$CANVAS" "$DESIGN_ROOT"
else
  exec bun run "$DIR/handoff.ts" --emit "$CANVAS"
fi
