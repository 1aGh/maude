#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=${SHOTS_OUT:-.scr/impl}
for T in light dark; do
  for g in a g; do G=$g bun .scr/run.mjs .scr/s13.mjs $T; done
done
echo CHAIN-fix3-DONE
