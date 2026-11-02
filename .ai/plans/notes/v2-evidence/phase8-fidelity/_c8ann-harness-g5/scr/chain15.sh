#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
for t in ${THEMES:-light}; do
  for g in ${GRP:-a b c d}; do G=$g bun .scr/run.mjs .scr/s15.mjs $t; done
done
echo CHAIN15-DONE
