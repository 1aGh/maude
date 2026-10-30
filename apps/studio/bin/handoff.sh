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
  echo "usage: maude design handoff <canvas-abs-path> [designRoot] [--target web|rn|lottie|tokens]"
  echo "  Emit <Slug>.registry.json (a shadcn registry handoff) next to the canvas."
  echo "  --target web (default) is this verb; rn, lottie and tokens are drafted by AI:"
  echo "  Handoff to production (Shift-Cmd-H) in Maude, or /design:to-rn and /design:to-lottie."
  exit 0
fi
# S8.10 — the target arg (any position). `web` is the shadcn registry item this verb emits; the others
# are an AI run (Handoff to production), so the verb names the command instead of guessing code.
TARGET=web
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 || { echo "handoff: --target needs a value" >&2; exit 2; } ;;
    --target=*) TARGET="${1#--target=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
case "$TARGET" in
  web) ;;
  rn) echo "handoff: a React Native component is drafted by AI — run /design:to-rn \"<canvas>\" --out <file>, or Handoff to production in Maude" >&2; exit 2 ;;
  lottie) echo "handoff: a Lottie animation is drafted by AI — run /design:to-lottie \"<canvas>\" --verify, or Handoff to production in Maude" >&2; exit 2 ;;
  tokens) echo "handoff: design tokens are drafted by AI — use Handoff to production in Maude (Design system › Hand off tokens)" >&2; exit 2 ;;
  *) echo "handoff: unknown --target $TARGET (web, rn, lottie or tokens)" >&2; exit 2 ;;
esac
if [ $# -lt 1 ]; then
  echo "usage: handoff.sh <canvas-abs-path> [designRoot] [--target web|rn|lottie|tokens]" >&2
  exit 2
fi

CANVAS="$1"
DESIGN_ROOT="${2:-}"

# Containment (V2-2.4b gate). The sidecar lands next to the canvas, and both arguments can come
# from project files a clone or a peer wrote (`_active.json`, config `designRoot`), so: the canvas
# is a `.tsx` whose REAL path (symlinks followed) is under the project's design root
# ($CLAUDE_PROJECT_DIR or the cwd, + /.design, realpath), and a designRoot argument is that same
# folder. Anything else: exit 2, nothing written.
refuse() { echo "handoff: $1" >&2; exit 2; }
real() { # the real path of an existing file or folder, or nothing
  if command -v realpath >/dev/null 2>&1; then realpath "$1" 2>/dev/null; return 0; fi
  if [ -d "$1" ]; then (cd -P "$1" 2>/dev/null && pwd -P); return 0; fi
  [ -e "$1" ] && [ ! -L "$1" ] || return 0
  local d; d="$(cd -P "$(dirname "$1")" 2>/dev/null && pwd -P)" && echo "$d/$(basename "$1")"
}
PROJECT_DESIGN="$(real "${CLAUDE_PROJECT_DIR:-$(pwd)}/.design")"
[ -n "$PROJECT_DESIGN" ] && [ -d "$PROJECT_DESIGN" ] \
  || refuse "no .design/ in this project — run it inside a Maude project"
case "$CANVAS" in *.tsx) ;; *) refuse "the canvas must be a .tsx file" ;; esac
CANVAS_REAL="$(real "$CANVAS")"
[ -n "$CANVAS_REAL" ] && [ -f "$CANVAS_REAL" ] || refuse "no canvas at $CANVAS"
case "$CANVAS_REAL" in
  "$PROJECT_DESIGN"/*.tsx) ;;
  *) refuse "$CANVAS is not inside this project's design root ($PROJECT_DESIGN)" ;;
esac
# the sidecar is written next to the path given — that folder must be the canvas's real one too
DIR_REAL="$(real "$(dirname "$CANVAS")")"
case "$DIR_REAL/" in
  "$PROJECT_DESIGN"/*) ;;
  *) refuse "$CANVAS is not inside this project's design root ($PROJECT_DESIGN)" ;;
esac
if [ -n "$DESIGN_ROOT" ] && [ "$(real "$DESIGN_ROOT")" != "$PROJECT_DESIGN" ]; then
  refuse "designRoot $DESIGN_ROOT is not this project's design root ($PROJECT_DESIGN)"
fi

DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "$DESIGN_ROOT" ]; then
  exec bun run "$DIR/handoff.ts" --emit "$CANVAS" "$DESIGN_ROOT"
else
  exec bun run "$DIR/handoff.ts" --emit "$CANVAS"
fi
