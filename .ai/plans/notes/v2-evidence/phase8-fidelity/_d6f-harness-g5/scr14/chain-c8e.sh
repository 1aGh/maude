#!/bin/bash
# P8 c8 (p8-c8-edit): re-shoot the 14 Editing ids this round changed, one theme. usage: bash .scr/chain-c8e.sh <light|dark>
# s14b -> only ed-obj-multi is kept; s14h studio (lay-auto, lay-reorder, obj-order, comp-pick, comp-instance);
# s14i gators (text-edit, img, pen, lay-free, shape, text-style); s14j (edge-huge); s14e (edge-paste, edge-keys); s14g (inspector).
cd "$(dirname "$0")/.." || exit 1
T=$1
export SHOTS_OUT=.scr/impl SHOT_CHANNEL="${SHOT_CHANNEL-chrome}"
mkdir -p .scr/impl/14-editing .scr/impl/_c8-keep
run() { local out; out=$(bun .scr/run.mjs "$@" 2>&1); echo "$out" | grep -E "^shot|FAIL|RUN ERROR|pageerrors"; if ! echo "$out" | grep -q '^shot'; then echo "NO SHOTS:"; echo "$out" | tail -12; fi; }
run .scr/s14b.mjs $T
mv ".scr/impl/14-editing/ed-obj-multi-$T.png" .scr/impl/_c8-keep/ 2>/dev/null
rm -f .scr/impl/14-editing/*-$T.png
mv ".scr/impl/_c8-keep/ed-obj-multi-$T.png" .scr/impl/14-editing/
run .scr/s14h.mjs $T
run .scr/s14i.mjs $T
run .scr/s14j.mjs $T
FX= run .scr/s14e.mjs $T
run .scr/s14g.mjs $T
echo "CHAIN-C8E-DONE $T"
