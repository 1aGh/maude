#!/usr/bin/env bash
# scripts/v2-perf-real.sh — V2-8.14 on the REAL Alligators project (an unlinked copy), v2 only:
# the Canvases panel on the real 94 canvases, then Home's data path and first paint over the
# index the project server built.
#
#   scripts/v2-perf-real.sh --root <unlinked copy that holds .design/> --out <dir>
#
# The copy is cloned first (the server writes `_canvas-state/` etc. into whatever it serves), then
# a studio server boots on it in a throwaway HOME (stub claude, NO_OPEN=1) and is killed on exit.
# Refuses a root that is still linked to a hub (`linkedHub`, `_sync.json`, `_state/`).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC=""
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) SRC="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "v2-perf-real: unknown arg $1" >&2; exit 2 ;;
  esac
done
[[ -d "$SRC/.design" && -n "$OUT" ]] || { echo "usage: v2-perf-real.sh --root <copy> --out <dir>" >&2; exit 2; }
if grep -q linkedHub "$SRC/.design/config.json" || [[ -e "$SRC/.design/_sync.json" || -e "$SRC/.design/_state" ]]; then
  echo "v2-perf-real: refusing a LINKED project (linkedHub / _sync.json / _state)" >&2
  exit 2
fi
mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/maude-perf-real.XXXXXX")"
SPID=""
cleanup() { [[ -n "$SPID" ]] && kill "$SPID" 2>/dev/null; sleep 1; rm -rf "$WORK"; }
trap cleanup EXIT
cp -R "$SRC" "$WORK/project" || exit 1
PORT=4850
node "$ROOT/scripts/v2-perf-boot.mjs" --root "$WORK/project" --port "$PORT" --home "$WORK/home" > "$WORK/boot.log" 2>&1 &
SPID=$!
for _ in $(seq 1 90); do grep -q "^READY" "$WORK/boot.log" 2>/dev/null && break; sleep 1; done
grep -q "^READY" "$WORK/boot.log" || { tail -20 "$WORK/boot.log" >&2; exit 1; }
echo "uptime: $(uptime)" > "$OUT/real-env.txt"
node "$ROOT/scripts/v2-perf-panel.mjs" --url "http://localhost:$PORT/" --runs 6 --json \
  > "$OUT/real-panel.json" 2> "$OUT/real-panel.log"
echo "panel exit $?"
# let the project server's first index/cover work settle before Home reads the index it wrote
sleep 20
node "$ROOT/scripts/v2-perf-home.mjs" --index-dir "$WORK/home/index" --work "$WORK/home-work" --runs 30 --page \
  > "$OUT/real-home.json" 2> "$OUT/real-home.log"
echo "home exit $?"
