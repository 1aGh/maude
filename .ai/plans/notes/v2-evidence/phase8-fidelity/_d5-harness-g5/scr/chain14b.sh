#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
for t in light dark; do
  bun .scr/run.mjs .scr/s14a.mjs $t
  FX=gators bun .scr/run.mjs .scr/s14a.mjs $t
  FX=gators bun .scr/run.mjs .scr/s14b.mjs $t
  bun .scr/run.mjs .scr/s14c.mjs $t
done
echo CHAIN14B-DONE
