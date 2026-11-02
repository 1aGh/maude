#!/bin/bash
# usage: lanes.sh <outdir> <theme> <groups...>   — runs s13 groups sequentially, then writes <outdir>/lanes.done
cd "$(dirname "$0")/.."
OUT=$1; THEME=$2; shift 2
rm -f "$OUT/lanes.done"
mkdir -p "$OUT"
for g in "$@"; do
  if [ "$g" = "p" ]; then
    SHOTS_OUT=$OUT bun .scr/run.mjs .scr/s13p.mjs $THEME > "$OUT/log-$g-$THEME.txt" 2>&1
  else
    SHOTS_OUT=$OUT G=$g bun .scr/run.mjs .scr/s13.mjs $THEME > "$OUT/log-$g-$THEME.txt" 2>&1
  fi
done
echo done > "$OUT/lanes.done"
