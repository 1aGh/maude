#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
bash .scr/chain-d3.sh light
bash .scr/chain-d3.sh dark
bun .scr/dsboard.mjs
echo CHAIN-D4-ALL-DONE
