#!/usr/bin/env bash
# describe.sh — search in pictures from a terminal: describe this project's pictures with the
# asset-describer agent (S12.13, contract V2-1.17 §5.9). Reached via `maude design describe`
# (DDR-062), never a raw bin path. Spends the person's Claude account → the permission card.
#
# Usage:
#   describe.sh                  # one batch now (up to 10 pictures)
#   describe.sh --batch N        # up to N batches (1-20), 20 seconds apart
#   describe.sh --status         # on or off, how many pictures are described, why it waits
#   describe.sh --stop           # stop describing (it stays on; Resume is the person's, in Assets)
#   describe.sh --json           # machine-readable (combine with the others)
#   describe.sh --root <project> # default: $CLAUDE_PROJECT_DIR, else the current directory
#
# Sends nothing without the person's yes in Assets. Same budget as the studio (one batch in flight
# per Mac, the project's daily cap). The agent runs Read only in an OS temp dir of tiles: no project
# path reaches it. Exit 0 ok · 1 error · 2 usage · 3 off or stopped · 4 waiting.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "describe.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

case "$1" in
  --help|-h) sed -n '2,17p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

exec bun run "$SCRIPT_DIR/_describe.mjs" "$@"
