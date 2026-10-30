#!/usr/bin/env bash
# ds-check.sh — design-system schema checker (V2-2.15, contract V2-1.13 §5.8). Reached via
# `maude design ds-check` (DDR-062), never a raw bin path. Read-only unless --emit / --fix.
#
# Usage:
#   ds-check.sh [<ds>… | --all]            # system level: 0 conformant · 10 missing roles · 11 private-only
#   ds-check.sh <ds> --json                # the maude.ds-check-report (levels, reasons, tier lists, C7)
#   ds-check.sh <ds> --emit                # write system/<ds>/tokens.json (13 on a converted system)
#   ds-check.sh --canvas <file>… [--json]  # S-rules for canvases (12 = a blocking finding)
#   ds-check.sh <ds> --canvases            # the system plus every canvas that uses it
#   ds-check.sh --changed <file>:<a>-<b>   # findings on changed lines only (/design:edit)
#   ds-check.sh --fix=mechanical [--dry-run] --canvas <file>   # alias / own-css / wrapper autofixes
#   ds-check.sh --cheatsheet <ds>          # the ≤ 60-line role cheat-sheet for /design:new
#   ds-check.sh --hook --canvas <file>     # PostToolUse mode: always exit 0, hook JSON
#   ds-check.sh --root <project>           # default: $CLAUDE_PROJECT_DIR, else the current directory
#
# Structure only — presence, per-theme presence, value TYPE, name/type collisions. Values,
# ordering and aesthetics are never judged (A14, DDR-043); they surface as notes.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "ds-check.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

case "$1" in
  --help|-h) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

exec bun run "$SCRIPT_DIR/_ds-check.mjs" "$@"
