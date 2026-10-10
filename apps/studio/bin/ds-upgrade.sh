#!/usr/bin/env bash
# ds-upgrade.sh — "bring a design system up to the schema" (V2-2.15, contract V2-1.13 §5.10).
# Reached via `maude design ds-upgrade` (DDR-062), never a raw bin path. Never implicit.
#
# Usage:
#   ds-upgrade.sh <ds> --analyse              # the check + the mechanical plan (read-only)
#   ds-upgrade.sh <ds> --plan-mechanical      # the plan JSON alone (read-only)
#   ds-upgrade.sh <ds> --validate <plan.json> # invariants V1–V4, V8 (13 = refused, nothing written)
#   ds-upgrade.sh <ds> --stage <plan.json>    # result into <designRoot>/_state/ds-upgrade/<ds>/<stamp>/
#   ds-upgrade.sh <ds> --apply <plan.json>    # validate, then write the tokens CSS (permission card)
#   ds-upgrade.sh --root <project>            # default: $CLAUDE_PROJECT_DIR, else the current directory
#
# The plan's judgement items (new role values, collisions, component map) come from the AI run
# (skill design-system § upgrade-schema); everything else is deterministic span edits.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "ds-upgrade.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

case "$1" in
  --help|-h) sed -n '2,14p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

exec bun run "$SCRIPT_DIR/_ds-upgrade.mjs" "$@"
