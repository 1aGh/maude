#!/usr/bin/env bash
# check.sh — validate the files Claude writes (V2-2.4b, contract V2-1.11 §5.2/§5.3, V2-1.18 §5.3).
# Reached via `maude design check` (DDR-062), never a raw bin path. Read-only.
#
# Usage:
#   check.sh <file…> [--json] [--strict] [--tier fast|stop] [--against <snapshot>] [--root <project>]
#
#   <file>       design-root-relative (ui/Pricing.tsx), .design/…-prefixed, or absolute
#   --strict     AI writes: a lenient-loader drop is an error, not a warning
#   --tier       fast (every write; the PostToolUse hook) or stop (the end of a run)
#   --against    the bytes before the edit, for the id-preservation checks (one file only)
#   --json       [{ file, kind, ok, ms, errors, warnings, infos }]
#
# Exit 0 ok · 1 errors (one `[code] where · what · fix` line each) · 2 usage.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "check.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

case "$1" in
  --help|-h) sed -n '2,15p' "$0" | sed 's/^# \?//' | sed 's/^check.sh/maude design check/'; exit 0 ;;
esac

exec bun run "$SCRIPT_DIR/_check.mjs" "$@"
