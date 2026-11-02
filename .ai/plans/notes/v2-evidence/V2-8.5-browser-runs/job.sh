#!/usr/bin/env bash
# usage: job.sh <jobname> <file>...   (runs from the repo root on the mini slot)
J="$1"; shift
OUT=".ai/plans/notes/v2-evidence/V2-8.5-browser-runs/$J"
mkdir -p "$OUT" ".shots-$J"
export E2E_SHOTS_DIR="$PWD/.shots-$J" MAUDE_E2E_OUT="$PWD/.shots-$J"
node --version > "$OUT/env.txt"; bun --version >> "$OUT/env.txt"; git rev-parse HEAD >> "$OUT/env.txt"
for run in 1 2; do
  for f in "$@"; do
    b="$(basename "$f")"
    node --test --test-force-exit "$f" > "$OUT/run$run-$b.log" 2>&1
    echo "run$run $f rc=$?" >> "$OUT/summary.txt"
  done
done
cat "$OUT/summary.txt"
