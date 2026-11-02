#!/bin/bash
# round 7 (p8-c7-ds): every 13 id the round touched, light then dark. Order: s13 groups a b c e f g h i j, s13p, then the board crops.
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
for T in light dark; do
  for g in a b c e f g h i j; do G=$g bun .scr/run.mjs .scr/s13.mjs $T; done
  bun .scr/run.mjs .scr/s13p.mjs $T
done
bun .scr/dsboard.mjs
echo CHAIN-C7-DONE
