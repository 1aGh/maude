#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
rm -f .scr/chain4.done
G=c bun .scr/run.mjs .scr/s15.mjs dark
FX=gators bun .scr/run.mjs .scr/s14c.mjs dark
echo CHAIN4-DONE > .scr/chain4.done
