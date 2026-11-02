#!/usr/bin/env bash
# runs.sh — the AI runs on this project (S5.4, contract V2-1.15 §5.4 / §5.10).
# Reached via `maude design runs` (DDR-062), never a raw bin path.
#
# Usage:
#   runs.sh list [--canvas <canvas>] [--json]   # which artboards AI is changing now (read-only)
#   runs.sh stop <run>                          # stop one of YOUR runs on this Mac
#
# Asks the project's running studio (`GET /_api/ai/runs`, `POST /_api/ai/runs/<run>/stop`). A
# terminal Claude reads `list` before it plans, so it works on the free artboards.
# Exit 0 ok · 1 the studio refused / not your run · 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "runs.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_runs.mjs" "$@"
