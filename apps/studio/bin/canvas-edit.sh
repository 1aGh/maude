#!/usr/bin/env bash
# canvas-edit.sh — AST-aware single-attribute edit on a canvas .tsx file.
# Wraps `apps/studio/canvas-edit.ts` so /design:edit Step 3a can
# shell out without booting a Bun module loader inline. Phase 3.6 Task 5.
#
# Usage:  canvas-edit.sh <canvas-abs-path> <data-cd-id> <attr> <value>
#
#   <canvas-abs-path>  the .tsx canvas — absolute, or relative to the design
#                      root (`ui/C.tsx`) or the cwd. It must resolve (symlinks
#                      followed) inside this project's .design/, outside its
#                      `_*` runtime folders (V2-2.4b gate).
#   <data-cd-id>       8-hex id from the inspector / _locator.json
#   <attr>             "className" | "style.<prop>" | any JSX attribute name
#   <value>            new value (bare string for className / plain attrs;
#                      a JS expression for style.<prop> — e.g. '"#facc15"',
#                      `14`, `"calc(100% - 2px)"`)
#
# Exit codes:
#   0   edit applied (or no-op when source already matched)
#   1   bad usage / missing file / the element is locked, or inside a locked
#       one (`soft-locked: …` — the person's, never the AI's; V2-2.19)
#   2   canvas outside the project's design folder ("Pick a canvas inside the
#       project's design folder"), or the AST edit failed (id not found, parse
#       error, unsupported attribute shape)
#
# Output:
#   On success, prints one JSON line: {"canvas": "...", "id": "...", "delta": <int>}
#   On failure, prints the underlying error to stderr.
#
# This script intentionally has no fallback path — Bun is the only supported
# runtime (DDR-009). Callers should pre-flight `mdcc --version` if the
# environment is uncertain.

set -euo pipefail

if [ $# -lt 4 ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "Usage: canvas-edit.sh <canvas-abs-path> <data-cd-id> <attr> <value>" >&2
  [ "$1" = "--help" ] || [ "$1" = "-h" ] && exit 0
  exit 1
fi

CANVAS="$1"
ID="$2"
ATTR="$3"
VALUE="$4"

HERE="$(cd "$(dirname "$0")/.." && pwd)"

# canvas-edit.ts resolves + contains the path and checks the lock; its exit
# code (0 / 1 / 2) passes straight through — anything else is a crash (2).
RC=0
bun --silent run "$HERE/canvas-edit.ts" --invoke "$CANVAS" "$ID" "$ATTR" "$VALUE" 2>&1 || RC=$?
case "$RC" in
  0|1|2) exit "$RC" ;;
  *) exit 2 ;;
esac
