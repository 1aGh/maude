#!/usr/bin/env bash
# runtime-health.sh — verify the dev-server is serving the on-disk pre-built
# runtime bundles, not a defective dynamic Bun.build output.
#
# Why: a stale dev-server process can cache a broken dynamic build of
# /_canvas-runtime/<slug>.js (e.g. a 409-line motion_react.js with a hoisting
# bug instead of the 10056-line pre-built). The canvas TSX parses cleanly,
# server returns HTTP 200, but the iframe throws at module-eval time with
# `ReferenceError: AcceleratedAnimation is not defined` (or similar).
#
# Parse-clean ≠ run-clean. This helper closes that gap with TWO checks:
#   1. Per-bundle absolute floor — served body MUST clear the size declared
#      in dist/runtime/.min-sizes.json. This catches the v0.22.0 regression
#      class where the installed bundle on disk is ITSELF defective (so
#      compare-to-disk would trivially pass).
#   2. Compare-to-disk ratio — served body MUST be ≥ threshold × on-disk
#      size. Catches the original case where disk is good but the running
#      dev-server returned a defective dynamic Bun.build cached in memory.
#
# Usage:
#   runtime-health.sh [--port N] [--root <repo>] [--threshold 0.5]
#                     [--restart] [--quiet]
#
# Behavior:
#   --restart  → on detected defect, kill the server PID from _server.json
#                and respawn via server-up.sh. Exit 0 if the restart heals.
#   --quiet    → silence per-bundle PASS lines; only print failures + summary.
#
# Exit codes:
#   0 all bundles healthy (or --restart healed the defect)
#   1 server unreachable / no _server.json
#   2 bad args
#   3 defective bundle detected (and either no --restart, or restart did not heal)

PORT=""
REPO=""
THRESHOLD="0.5"
RESTART=0
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port)      PORT="$2"; shift 2 ;;
    --root)      REPO="$2"; shift 2 ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --restart)   RESTART=1; shift ;;
    --quiet)     QUIET=1; shift ;;
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "runtime-health.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

# ---------- repo + plugin root resolution ----------
if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PREBUILT_DIR="$PLUGIN_ROOT/dev-server/dist/runtime"
if [ ! -d "$PREBUILT_DIR" ]; then
  PREBUILT_DIR="$SCRIPT_DIR/../dist/runtime"
fi
if [ ! -d "$PREBUILT_DIR" ]; then
  echo "runtime-health.sh: pre-built runtime dir not found at $PREBUILT_DIR" >&2
  echo "  (canvas runtime bundles ship in <plugin>/dev-server/dist/runtime/)" >&2
  exit 1
fi

# Absolute-floor manifest. Optional — if missing we fall back to the
# disk-ratio check alone (older installs from before .min-sizes.json shipped).
MIN_SIZES_MANIFEST="$PREBUILT_DIR/.min-sizes.json"
floor_for() {
  local slug="$1"
  [ -f "$MIN_SIZES_MANIFEST" ] || { echo ""; return; }
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$slug" '.[$k] // empty' "$MIN_SIZES_MANIFEST" 2>/dev/null
  else
    python3 -c '
import json, sys
try:
  with open("'"$MIN_SIZES_MANIFEST"'") as f: data = json.load(f)
  v = data.get("'"$slug"'")
  print(v if v is not None else "")
except Exception: print("")
' 2>/dev/null
  fi
}

# ---------- resolve port from _server.json if not given ----------
DESIGN_ROOT="$REPO/.design"
STATE="$DESIGN_ROOT/_server.json"
# #206 T6.3d — the desktop app's attested server first. APP_OWNED=1 means --restart must never kill it.
. "$SCRIPT_DIR/_desktop-locate.sh"
APP_OWNED=0
if [ -z "$PORT" ]; then
  desktop_port "$REPO"
  case $? in
    0) PORT="$DESKTOP_PORT"; APP_OWNED=1 ;;
    11) exit 1 ;;
  esac
fi
if [ -z "$PORT" ]; then
  if [ ! -f "$STATE" ]; then
    echo "runtime-health.sh: no --port given and $STATE not found (run server-up.sh first)" >&2
    exit 1
  fi
  if command -v jq >/dev/null 2>&1; then
    PORT=$(jq -r .port "$STATE" 2>/dev/null)
  else
    PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
  fi
fi
[ -z "$PORT" ] && { echo "runtime-health.sh: could not resolve port" >&2; exit 1; }

BASE="http://localhost:$PORT"

# Confirm server alive before probing individual bundles.
if ! curl -fs "$BASE/_health" >/dev/null 2>&1; then
  echo "runtime-health.sh: server not responding at $BASE/_health" >&2
  exit 1
fi

# ---------- per-bundle probe ----------
probe_one() {
  local slug="$1"
  local disk_size="$2"
  local url="$BASE/_canvas-runtime/$slug"
  local served
  served=$(curl -fs -o /dev/null -w '%{size_download}' "$url" 2>/dev/null) || {
    echo "✗ $slug — served HTTP error (curl failed for $url)" >&2
    return 1
  }
  # Hard floor at 256 bytes — any working ESM bundle is bigger than that.
  if [ "$served" -lt 256 ]; then
    echo "✗ $slug — served body $served B < 256 B floor (server returned empty)" >&2
    return 1
  fi
  # Absolute floor from .min-sizes.json (independent of disk — catches the
  # case where the SHIPPED bundle is itself defective, like v0.22.0 motion_react).
  local abs_floor
  abs_floor=$(floor_for "$slug")
  if [ -n "$abs_floor" ] && [ "$served" -lt "$abs_floor" ]; then
    echo "✗ $slug — served $served B < absolute floor $abs_floor B (declared in .min-sizes.json — defective bundle in install)" >&2
    return 1
  fi
  # Threshold ratio: served must be ≥ threshold × disk.
  # awk handles the fractional math without bc dependency.
  local ratio
  ratio=$(awk -v s="$served" -v d="$disk_size" 'BEGIN{ if(d==0){print 0}else{printf "%.3f", s/d} }')
  local ok
  ok=$(awk -v r="$ratio" -v t="$THRESHOLD" 'BEGIN{print (r >= t) ? 1 : 0}')
  if [ "$ok" = "1" ]; then
    [ $QUIET -eq 0 ] && echo "✓ $slug — $served B / $disk_size B disk (ratio $ratio${abs_floor:+, floor ${abs_floor} B})" >&2
    return 0
  fi
  echo "✗ $slug — served $served B / $disk_size B disk (ratio $ratio < $THRESHOLD) — defective dynamic build" >&2
  return 1
}

FAIL_COUNT=0
FAIL_LIST=""
for f in "$PREBUILT_DIR"/*.js; do
  [ -f "$f" ] || continue
  SLUG=$(basename "$f")
  DISK_SIZE=$(wc -c < "$f" | tr -d ' ')
  if ! probe_one "$SLUG" "$DISK_SIZE"; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_LIST="$FAIL_LIST $SLUG"
  fi
done

if [ "$FAIL_COUNT" -eq 0 ]; then
  [ $QUIET -eq 0 ] && echo "✓ runtime-health OK — all bundles match disk pre-built (threshold $THRESHOLD)" >&2
  exit 0
fi

echo "" >&2
echo "✗ runtime-health FAIL — $FAIL_COUNT bundle(s) below threshold:$FAIL_LIST" >&2
echo "  These bundles look defective." >&2
echo "  The canvas TSX will parse + serve cleanly, but the iframe will throw at runtime." >&2
echo "" >&2
echo "  If the failure was from the 'absolute floor' check (see lines above):" >&2
echo "    → the SHIPPED bundle on disk is itself defective (rare release-time regression)." >&2
echo "    → --restart will NOT help; upgrade the package: \`npm i -g @1agh/maude@latest\`" >&2
echo "      (or for marketplace installs: \`/plugin marketplace update maude\`)." >&2
echo "  If the failure was from the 'ratio < threshold' check:" >&2
echo "    → the running server cached a defective dynamic Bun.build output." >&2
echo "    → --restart will respawn the server and load the (good) disk pre-built." >&2

if [ "$RESTART" -eq 1 ] && [ "$APP_OWNED" = 1 ]; then
  # #206 T6.3d (DDR-250 decision 7) — never kill the app's server: ask the app to restart it.
  if desktop_locate restart --root "$REPO"; then
    echo "→ asked Maude to restart this project's server; run runtime-health again in a few seconds" >&2
    exit 3
  fi
  echo "✗ Maude serves this project; restart it from Maude (the tab's Try again), not from here" >&2
  exit 3
fi

if [ "$RESTART" -eq 1 ]; then
  echo "→ --restart given; killing server and respawning via server-up.sh" >&2
  if [ -f "$STATE" ]; then
    if command -v jq >/dev/null 2>&1; then
      PID=$(jq -r .pid "$STATE" 2>/dev/null)
    else
      PID=$(sed -nE 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
    fi
    # never a pid the desktop app owns (its own, or a server it spawned): the file sits in the project
    if [ -n "$PID" ] && desktop_locate app-pid --pid "$PID"; then
      echo "✗ the server in $STATE is Maude's own; restart it from Maude, not from here" >&2
      exit 3
    fi
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      sleep 1
      kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null
    fi
    rm -f "$STATE"
  fi
  NEW_PORT=$(bash "$SCRIPT_DIR/server-up.sh" --root "$REPO")
  [ -z "$NEW_PORT" ] && { echo "✗ server-up.sh did not return a port after restart" >&2; exit 3; }
  echo "→ server restarted port=$NEW_PORT; re-probing once" >&2
  # Re-probe via tail-recursive invocation with no --restart (avoid infinite loop).
  bash "$0" --port "$NEW_PORT" --root "$REPO" --threshold "$THRESHOLD" $( [ $QUIET -eq 1 ] && echo --quiet )
  exit $?
fi

echo "  Remediation: rerun with --restart, OR manually 'kill $(cat $STATE 2>/dev/null | sed -nE 's/.*pid.*:.*([0-9]+).*/\1/p') && bash $SCRIPT_DIR/server-up.sh'" >&2
exit 3
