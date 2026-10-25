#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
T=${1:-light}
rm -f .scr/chain13.done
for g in ${2:-a b c d e f g h i j}; do G=$g bun .scr/run.mjs .scr/s13.mjs $T; done
echo DONE > .scr/chain13.done
