#!/usr/bin/env bash
# assets.sh — the project's assets, where they are used, and which are not (S8.11, contract
# V2-1.17 §5.3/§5.5). Reached via `maude design assets` (DDR-062), never a raw bin path. Read-only.
#
# Usage:
#   assets.sh                       # every asset: kind, size, how many canvases use it
#   assets.sh --usage <asset>       # the canvases that use one asset (assets/a1b2c3d4.png or just the name)
#   assets.sh --not-used            # assets nothing uses — nothing is listed until older versions are checked
#   assets.sh --json                # machine-readable (combine with the others)
#   assets.sh --root <project>      # default: $CLAUDE_PROJECT_DIR, else the current directory
#
# Asks the project's running studio (`.design/_server.json` → GET /_api/index?part=assets) and, when
# none runs, builds the static index in-process (nothing is written). Without the studio the older
# versions of canvases cannot be read, so --not-used says so instead of guessing: a picture an older
# version still shows is never reported as unused. Exit 0 ok · 1 unknown asset · 2 usage.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "assets.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

case "$1" in
  --help|-h) sed -n '2,15p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

exec bun run "$SCRIPT_DIR/_assets.mjs" "$@"
