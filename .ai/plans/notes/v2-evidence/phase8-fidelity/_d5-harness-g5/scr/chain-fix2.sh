#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=${SHOTS_OUT:-.scr/impl}
for T in light dark; do
  bun .scr/run.mjs .scr/s14b.mjs $T
  bun .scr/run.mjs .scr/s14c.mjs $T
done
bun .scr/dsboard.mjs
echo CHAIN-fix2-DONE
