#!/usr/bin/env bash
# index.sh — the project index for Claude and people (V2-2.17, contract V2-1.17 §5.3). Reached via
# `maude design index` (DDR-062), never a raw bin path. Read-only.
#
# Usage:
#   index.sh                       # canvases, artboards and kinds of this project
#   index.sh --q "pricing"         # find canvases and artboards (accents, any word order, one typo)
#   index.sh --canvas ui/x.tsx     # one canvas row
#   index.sh --json                # machine-readable (combine with --q / --canvas)
#   index.sh --root <project>      # default: $CLAUDE_PROJECT_DIR, else the current directory
#
# Asks the project's running studio (`.design/_server.json` → GET /_api/index) and, when none runs,
# builds the static index in-process (nothing is written). Lets an agent find "the pricing
# artboard" without reading every canvas file.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "index.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

case "$1" in
  --help|-h) sed -n '2,14p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

exec bun run "$SCRIPT_DIR/_index-cli.mjs" "$@"
