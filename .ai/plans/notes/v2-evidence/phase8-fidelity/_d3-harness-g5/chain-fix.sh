#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=${SHOTS_OUT:-.scr/impl}
for T in light dark; do
  for g in ${GROUPS_:-a b d f h i}; do G=$g bun .scr/run.mjs .scr/s13.mjs $T; done
done
FX=gators bun .scr/run.mjs .scr/s14c.mjs light
echo CHAIN-fix-DONE
