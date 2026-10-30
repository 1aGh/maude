#!/usr/bin/env bash
# reel-place.sh — S7.14 (contract V2-1.10 §5.7, §5.9): the AI cut, one shot per call. Appends the first
# shot of `<designRoot>/<edl-slug>.edl.json` the video does not have yet (matched by name) as one literal
# <TransitionSeries.Sequence>, and TOTAL follows. Inside an AI run each call is one staged write of the run,
# so the shots land live and Stop keeps what is placed. Reached via `maude design reel-place` (DDR-062),
# never a raw bin path. Logic: _reel-place.mjs.
# Exit 0 placed · 1 refused (the check failed / the video can't take it) · 2 usage · 4 all shots are placed.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "reel-place.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_reel-place.mjs" "$@"
