#!/usr/bin/env bash
# cut-to-beat.sh — S7.6c (contract V2-1.10 §5.6/§5.7): Cut to the beat for an agent — the comp's
# beats (GET /_api/comp-media) into one undoable `video.cut-to-beat` edit op through the running
# studio. Reached via `maude design cut-to-beat` (DDR-062), never a raw bin path. Logic:
# _video-verbs.mjs. Exit 0 ok · 1 the studio refused / no beats · 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "cut-to-beat.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_video-verbs.mjs" cut-to-beat "$@"
