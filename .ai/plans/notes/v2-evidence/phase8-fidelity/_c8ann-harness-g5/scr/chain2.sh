#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
for t in dark light; do
  for g in h i j; do G=$g bun .scr/run.mjs .scr/s13.mjs $t; done
  G=d bun .scr/run.mjs .scr/s15.mjs $t
done
G=a bun .scr/run.mjs .scr/s15.mjs dark
bun .scr/dsboard.mjs
echo CHAIN2-DONE
