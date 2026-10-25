#!/usr/bin/env bash
# scripts/v2-perf-bench.sh — the V2-8.8 batch: pre-v2 against v2 on the Alligators-scale fixture,
# Chromium, in the order given (V2-1.8 contract T5/M7; the plan wants two batches in OPPOSITE order).
#
#   scripts/v2-perf-bench.sh [--order "base v2"] [--base <rev>] [--repeat 6] [--window 1600x1000]
#                            [--out <dir>] [--canvas ui/c12.tsx]
#
# One invocation = one batch. For each arm (`base` = the pre-v2 build at <rev>, a `main` release;
# `v2` = this checkout) it release-builds the client, boots that arm's studio server on its OWN copy
# of the generated fixture (apps/studio/test/fixtures/gen-format-fixture.mjs: 93 canvases, `ui/c12`
# has 21 artboards; unlinked, deterministic), then measures THIS checkout's instrument
# (apps/studio/bin/perf.sh — so the ruler is the same for both arms):
#   studio  Chromium inside the studio shell, canvas iframe, Retina page at --window, fit-all
#           (the shell is what differs: v2's islands over a full-width canvas vs the pre-v2 docked
#           panels — this is the M7 comparison)
#   bare    Chromium on the bare canvas page, fit-all (the canvas engine alone)
# Writes <out>/<arm>-{studio,bare}.json (+ .txt reports) and <out>/env.txt (uptime, machine).
# Not CI: frame timings swing with machine load; read the medians against the spread.
#
# Meant for the Mac mini lane (display-free):
#   scripts/remote-lane.sh --slot auto --fetch .ai/plans/notes/v2-evidence/p8-perf/<batch> -- \
#     scripts/v2-perf-bench.sh --out .ai/plans/notes/v2-evidence/p8-perf/<batch>
# Safety: every server runs in a throwaway HOME with a stub claude, NO_OPEN=1, and is killed on exit.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORDER="base v2"
BASE_REV=""
REPEAT=6
WINDOW=1600x1000
CANVAS=ui/c12.tsx
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --order) ORDER="$2"; shift 2 ;;
    --base) BASE_REV="$2"; shift 2 ;;
    --repeat) REPEAT="$2"; shift 2 ;;
    --window) WINDOW="$2"; shift 2 ;;
    --canvas) CANVAS="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "v2-perf-bench: unknown arg $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUT" ]] || OUT="$ROOT/.ai/plans/notes/v2-evidence/p8-perf/batch-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/maude-perf-bench.XXXXXX")"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
  sleep 1
  git -C "$ROOT" worktree remove --force "$WORK/base" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---- the pre-v2 checkout ----
if [[ -z "$BASE_REV" ]]; then
  BASE_REV="$(git -C "$ROOT" merge-base HEAD main 2>/dev/null || true)"
fi
[[ -n "$BASE_REV" ]] || { echo "v2-perf-bench: no --base and no main to take it from" >&2; exit 2; }
git -C "$ROOT" worktree add --detach "$WORK/base" "$BASE_REV" >/dev/null 2>&1 \
  || { echo "v2-perf-bench: cannot check out $BASE_REV" >&2; exit 1; }
ln -s "$ROOT/node_modules" "$WORK/base/node_modules" 2>/dev/null
echo "base = $BASE_REV ($(git -C "$WORK/base" describe --tags --always 2>/dev/null)); v2 = $(git -C "$ROOT" rev-parse --short HEAD)"
(cd "$WORK/base/apps/studio" && bun install --frozen-lockfile >/dev/null 2>&1) \
  || echo "v2-perf-bench: base bun install failed — falling back to the slot's node_modules" >&2
[[ -e "$WORK/base/apps/studio/node_modules" ]] || ln -s "$ROOT/apps/studio/node_modules" "$WORK/base/apps/studio/node_modules"

for arm in base v2; do
  dir="$ROOT"; [[ $arm == base ]] && dir="$WORK/base"
  (cd "$dir/apps/studio" && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release >/dev/null 2>&1) \
    || { echo "v2-perf-bench: release build failed for $arm" >&2; exit 1; }
  # a deterministic, UNLINKED fixture per arm (an arm's server writes _canvas-state etc. into it)
  cat > "$WORK/gen-$arm.mjs" <<EOF
import { generateFormatFixture } from '$ROOT/apps/studio/test/fixtures/gen-format-fixture.mjs';
generateFormatFixture(process.argv[2]);
EOF
  bun "$WORK/gen-$arm.mjs" "$WORK/fx-$arm" >/dev/null || { echo "fixture failed" >&2; exit 1; }
done

{
  echo "date: $(date -u +%FT%TZ)"
  echo "uptime: $(uptime)"
  echo "machine: $(uname -m) $(sysctl -n machdep.cpu.brand_string 2>/dev/null) cores=$(sysctl -n hw.ncpu 2>/dev/null)"
  echo "order: $ORDER   repeat: $REPEAT (first discarded)   window: $WINDOW dpr 2   canvas: $CANVAS"
  echo "base: $BASE_REV   v2: $(git -C "$ROOT" rev-parse HEAD)"
} > "$OUT/env.txt"

PORT=4830
for arm in $ORDER; do
  studio="$ROOT/apps/studio"; [[ $arm == base ]] && studio="$WORK/base/apps/studio"
  PORT=$((PORT + 1))
  node "$ROOT/scripts/v2-perf-boot.mjs" --studio "$studio" --root "$WORK/fx-$arm" --port "$PORT" \
    --home "$WORK/home-$arm" > "$WORK/boot-$arm.log" 2>&1 &
  SPID=$!
  PIDS+=("$SPID")
  for _ in $(seq 1 90); do grep -q "^READY" "$WORK/boot-$arm.log" 2>/dev/null && break; sleep 1; done
  grep -q "^READY" "$WORK/boot-$arm.log" || { echo "server for $arm never came up" >&2; tail -20 "$WORK/boot-$arm.log" >&2; exit 1; }
  echo "uptime before $arm: $(uptime)" >> "$OUT/env.txt"
  for lane in studio bare; do
    flags=(--fit-all --repeat "$REPEAT" --json)
    [[ $lane == studio ]] && flags+=(--studio --window "$WINDOW")
    MAUDE_PERF_ENGINE_TAG="$arm-$lane" bash "$ROOT/apps/studio/bin/perf.sh" --root "$WORK/fx-$arm" \
      --canvas "$CANVAS" "${flags[@]}" > "$OUT/$arm-$lane.json" 2> "$OUT/$arm-$lane.log"
    echo "$arm/$lane: exit $? — $(grep -c '^→ pass' "$OUT/$arm-$lane.log") passes"
  done
  kill "$SPID" 2>/dev/null
  wait "$SPID" 2>/dev/null
done
node "$ROOT/scripts/v2-perf-summary.mjs" "$OUT" | tee "$OUT/summary.txt"
