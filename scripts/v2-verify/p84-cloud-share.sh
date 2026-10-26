#!/usr/bin/env bash
# V2-8.4 rig, cloud shells only (P8 cloud-share re-run): stand the rig up (p84-up.mjs — a LOCAL
# cell, throwaway HOME, stub claude), run the cross-shell scenarios for the cloud owner and the
# cloud viewer (their last step is the Share sheet / Ask to edit), tear the rig down.
#
#   scripts/v2-verify/p84-cloud-share.sh <out-dir> [cell-port] [browser-port]
#
# Meant for scripts/remote-lane.sh (headless; never a real hub, cell or service).
set -uo pipefail
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
CELL_PORT="${2:-4881}"
BROWSER_PORT="${3:-4482}"
RUN="$OUT/run"
node scripts/v2-verify/p84-up.mjs "$RUN" --cell-port "$CELL_PORT" --browser-port "$BROWSER_PORT" \
  > "$OUT/up.log" 2>&1 &
UP=$!
for _ in $(seq 1 300); do
  [[ -f "$RUN/rig.json" ]] && break
  kill -0 "$UP" 2>/dev/null || break
  sleep 1
done
RC=1
if [[ -f "$RUN/rig.json" ]]; then
  node scripts/v2-verify/p84-scenarios.mjs "$RUN/rig.json" "$OUT/scenarios" owner viewer
  RC=$?
else
  echo "[p84-cloud-share] the rig never came up (see $OUT/up.log)" >&2
fi
cp "$RUN"/*.log "$OUT/" 2>/dev/null || true
kill -TERM "$UP" 2>/dev/null || true
sleep 5
kill -KILL "$UP" 2>/dev/null || true
exit "$RC"
