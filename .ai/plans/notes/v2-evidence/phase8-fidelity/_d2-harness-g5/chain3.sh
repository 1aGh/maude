#!/bin/bash
cd "$(dirname "$0")/.."
export SHOTS_OUT=.scr/impl
rm -f .scr/chain3.done
for g in a b c; do G=$g bun .scr/run.mjs .scr/s15.mjs light; done
G=c bun .scr/run.mjs .scr/s15.mjs dark
G=a bun .scr/run.mjs .scr/s13.mjs dark
bun .scr/run.mjs .scr/s14a.mjs light
FX=gators bun .scr/run.mjs .scr/s14a.mjs light
bun .scr/run.mjs .scr/s14b.mjs light
FX=gators bun .scr/run.mjs .scr/s14b.mjs light
bun .scr/run.mjs .scr/s14c.mjs light
FX=gators bun .scr/run.mjs .scr/s14c.mjs light
echo CHAIN3-DONE > .scr/chain3.done
