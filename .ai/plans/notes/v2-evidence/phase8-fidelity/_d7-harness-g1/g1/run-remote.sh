#!/usr/bin/env bash
# D6 G1 remote chain (runs from the repo root of a remote-lane slot).
#   scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7g1-impl -- \
#     bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g1/g1/run-remote.sh light,dark
set -uo pipefail
THEMES="${1:-light,dark}"
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g1/g1
rm -rf .scr/h .scr/d7g1-impl .scr/fx-cache .scr/impl-raw
mkdir -p .scr/h .scr/d7g1-impl
cp -R "$H"/. .scr/h/
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
# the mini has no Playwright chromium build: use its installed Chrome
export D5_REPO="$PWD" D5_CHANNEL=chrome D5_OUT=.scr/d7g1-impl
# D7: canvas 01 only (s01ai s01b s01c s01d + the two Home scenes of 01)
export D5_HOME_ONLY=cf-home-prompt,cf-home-prompt.target
node .scr/h/chain.mjs "$THEMES" s01ai.mjs s01b.mjs s01c.mjs s01d.mjs
cat .scr/chain.log
# leave the slot clean: committed dist back, harness copy gone
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
rm -rf .scr/h
ls .scr/d7g1-impl | wc -l
