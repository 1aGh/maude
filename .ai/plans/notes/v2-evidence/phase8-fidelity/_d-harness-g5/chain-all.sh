#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
for t in dark light; do
  for g in a b c d e f g; do G=$g bun .scr/run.mjs .scr/s13.mjs $t; done
  bun .scr/run.mjs .scr/s14a.mjs $t
  FX=gators bun .scr/run.mjs .scr/s14a.mjs $t
  bun .scr/run.mjs .scr/s14b.mjs $t
  FX=gators bun .scr/run.mjs .scr/s14b.mjs $t
  bun .scr/run.mjs .scr/s14c.mjs $t
  FX=gators bun .scr/run.mjs .scr/s14c.mjs $t
  for g in a b c e f; do G=$g bun .scr/run.mjs .scr/s15.mjs $t; done
  echo THEME-$t-DONE
done
echo ALL-DONE
