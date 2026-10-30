#!/usr/bin/env bash
# ds.sh — the design-system verbs (S10.3, contract V2-1.6 §5.12 + S10 §2.4). Reached via
# `maude design ds <sub>` (DDR-062), never a raw bin path.
#
#   status [<ds>]                    the systems' states (auto)
#   publish <ds> [--leave-out <canvas>]… [--dry-run]   "Update N canvases" (alias update)
#   pending <ds> --set <file.json> | --cancel
#   keep <ds> · undo <ds>            an outside change
#   pick <ds> <css> --use canvas|file · pick <ds> --head <rev>
#   canvas update|leave <canvas>
#   trash <ds> <css> --replacement <css> · restore <ds> <css> · clear <ds> <css> (owner)
#   usage <ds> [--css <name>] [--component <name>]   (auto)
#   revisions list <ds>              (auto)
#   --json · --root <project>        default: $CLAUDE_PROJECT_DIR, else the current directory
#
# Asks the project's running studio; with none, runs the same operation in-process (writes that
# change canvas metas then refuse `ds-kernel-unavailable` — open the project in Maude).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "ds.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  exit 1
fi

case "$1" in
  --help|-h|"") sed -n '2,17p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

exec bun run "$SCRIPT_DIR/_ds.mjs" "$@"
