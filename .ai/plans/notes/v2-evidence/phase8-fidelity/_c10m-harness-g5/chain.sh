#!/bin/bash
# Round 10 (p8-c10-misc): 13 · ds-edit-reach (s13 G=b) + ds-multi-panel (s13p), ONE theme, on top of the D6f harness.
#   scripts/remote-lane.sh --slot auto --max 3000 --fetch .scr/impl/13-design-system -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10m-harness-g5/chain.sh <light|dark>
cd "$(dirname "$0")/../../../../../.." || exit 1
T=$1
bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d6f-harness-g5/setup.sh 13 || exit 1
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
export SHOTS_OUT=.scr/impl
export SHOT_CHANNEL="${SHOT_CHANNEL-chrome}"
mkdir -p .scr/impl
rm -f .scr/impl/13-design-system/*-$T.png .scr/impl/13-design-system/*-$T.*.png
run() {
  local out
  out=$(bun .scr/run.mjs "$@" 2>&1)
  echo "$out" | grep -E "^shot|FAIL|RUN ERROR|pageerrors|^INSTANCE"
  if ! echo "$out" | grep -q '^shot'; then echo "NO SHOTS:"; echo "$out" | tail -15; fi
}
bun .scr/mk-dsconv.mjs 2>&1 | tail -2
echo "== s13 G=b $T"; G=b run .scr/s13.mjs $T
echo "== s13p $T"; run .scr/s13p.mjs $T
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
echo "CHAIN-C10M-DONE $T"
