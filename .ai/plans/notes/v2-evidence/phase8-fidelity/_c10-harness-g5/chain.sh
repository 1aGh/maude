#!/bin/bash
# P8 c10 (p8-c10-edit): re-shoot the 14 Editing ids, one or both themes. Run from anywhere (it cds to the repo root):
#   scripts/remote-lane.sh --fetch .scr/impl/14-editing -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10-harness-g5/chain.sh light dark
# Layers: _d5-harness-g5 (setup.sh) <- _c8e-harness-g5/scr <- _c10-harness-g5/scr (this folder: s14i's pen block, the Alligators
# fixture's Czech body line). Release-builds the client, shoots into .scr/impl/14-editing (+ the side shot ed-pen-draw).
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity
bash $H/_d5-harness-g5/setup.sh || exit 1
cp -R $H/_c8e-harness-g5/scr/. .scr/
cp -R $H/_c10-harness-g5/scr/. .scr/
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -2
export SHOTS_OUT=.scr/impl SHOT_CHANNEL="${SHOT_CHANNEL-chrome}"
mkdir -p .scr/impl/14-editing .scr/impl/_c8-keep
run() { local out; out=$(bun .scr/run.mjs "$@" 2>&1); echo "$out" | grep -E "^shot|FAIL|RUN ERROR|pageerrors|^PEN|^TEXT-EDIT"; if ! echo "$out" | grep -q '^shot'; then echo "NO SHOTS:"; echo "$out" | tail -12; fi; }
for T in "$@"; do
  # s14b keeps only ed-obj-multi
  run .scr/s14b.mjs $T
  mv ".scr/impl/14-editing/ed-obj-multi-$T.png" .scr/impl/_c8-keep/ 2>/dev/null
  rm -f .scr/impl/14-editing/*-$T.png
  mv ".scr/impl/_c8-keep/ed-obj-multi-$T.png" .scr/impl/14-editing/ 2>/dev/null
  run .scr/s14h.mjs $T
  run .scr/s14i.mjs $T
  run .scr/s14j.mjs $T
  FX= run .scr/s14e.mjs $T
  run .scr/s14g.mjs $T
  echo "CHAIN-C10-DONE $T"
done
