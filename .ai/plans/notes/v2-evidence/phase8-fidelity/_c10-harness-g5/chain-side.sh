#!/bin/bash
# P8 c10: the side shot of the Pen being drawn (ed-pen-draw: the ring + "Click here to close"), both themes.
#   scripts/remote-lane.sh --fetch .scr/impl/14-editing -- .ai/plans/notes/v2-evidence/phase8-fidelity/_c10-harness-g5/chain-side.sh light dark
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity
bash $H/_d5-harness-g5/setup.sh || exit 1
cp -R $H/_c8e-harness-g5/scr/. .scr/
cp -R $H/_c10-harness-g5/scr/. .scr/
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -2
export SHOTS_OUT=.scr/impl SHOT_CHANNEL="${SHOT_CHANNEL-chrome}"
mkdir -p .scr/impl/14-editing
for T in "$@"; do
  ONLY=pen-draw bun .scr/run.mjs .scr/s14i.mjs $T 2>&1 | grep -E "^shot|FAIL|RUN ERROR|pageerrors|^PENDRAW"
  echo "CHAIN-SIDE-DONE $T"
done
