#!/bin/bash
# c7-g15b: the whole of 15 (old groups first, the gesture groups after so their shots win) + 04 md-edit-image
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
for t in ${THEMES:-light dark}; do
  for g in a b c d e f; do G=$g bun .scr/run.mjs .scr/s15.mjs $t 2>&1 | grep -E "^shot|FAIL|RUN ERROR"; done
  for g in g1 g2 g3 g4 g5; do G=$g bun .scr/run.mjs .scr/s15g.mjs $t 2>&1 | grep -E "^shot|FAIL|RUN ERROR"; done
  bun .scr/run.mjs .scr/s04i.mjs $t 2>&1 | grep -E "^shot|FAIL|RUN ERROR"
done
echo CHAIN-G15B-DONE
