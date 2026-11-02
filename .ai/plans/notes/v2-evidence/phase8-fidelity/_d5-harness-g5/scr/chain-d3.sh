#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=${SHOTS_OUT:-.scr/impl}
T=${1:-light}
for g in a b c d e f g h i j; do G=$g bun .scr/run.mjs .scr/s13.mjs $T; done
for s in s14a s14b s14c; do
  bun .scr/run.mjs .scr/$s.mjs $T
  FX=gators bun .scr/run.mjs .scr/$s.mjs $T
done
echo CHAIN-$T-DONE
