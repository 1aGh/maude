#!/bin/bash
# D4 extras: the states D3 called unreachable that the product does draw (s13s off-system question, s13u schema upgrade, s14ai AI holds)
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
for s in s13s s13u s14ai; do
  bun .scr/run.mjs .scr/$s.mjs light,dark
done
echo CHAIN-X-DONE
