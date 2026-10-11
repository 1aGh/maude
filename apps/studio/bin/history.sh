#!/usr/bin/env bash
# history.sh — the versions of this project (V2-2.4b, contract V2-1.11 §5.3, V2-1.9 §5.11).
# Reached via `maude design history` (DDR-062), never a raw bin path.
#
# Usage:
#   history.sh list [<canvas>] [--limit N] [--json]      # versions, newest first        (read-only)
#   history.sh show <ref> [<canvas>] [--json]            # one version                   (read-only)
#   history.sh diff [<canvas>] [--from <ref>] [--json]   # what changed since <ref>      (read-only)
#
# Asks the project's running studio: a synced project answers its accepted versions (r<n>), a
# local one its git log. Exit 0 ok · 1 not found / not available · 2 usage · 3 no studio running.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "history.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_history.mjs" "$@"
