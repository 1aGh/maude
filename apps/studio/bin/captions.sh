#!/usr/bin/env bash
# captions.sh — S7.6c (contract V2-1.10 §5.7): a video's captions for an agent — `add` (transcribe
# locally, then one undoable edit op through the running studio), `list`, `export`. Reached via
# `maude design captions` (DDR-062), never a raw bin path. The logic is in _video-verbs.mjs.
# Exit 0 ok · 1 the studio refused · 2 usage · 3 no studio running / no speech engine on this Mac.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "captions.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_video-verbs.mjs" captions "$@"
