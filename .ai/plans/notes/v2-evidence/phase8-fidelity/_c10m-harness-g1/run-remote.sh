#!/usr/bin/env bash
# D6 G1 remote chain (runs from the repo root of a remote-lane slot).
#   scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d6g1-impl -- \
#     bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10m-harness-g1/run-remote.sh light,dark
set -uo pipefail
THEMES="${1:-light,dark}"
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_c10m-harness-g1
rm -rf .scr/h .scr/d6g1-impl .scr/fx-cache .scr/impl-raw
mkdir -p .scr/h .scr/d6g1-impl
cp -R "$H"/. .scr/h/
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
# the mini has no Playwright chromium build: use its installed Chrome
export D5_REPO="$PWD" D5_CHANNEL=chrome D5_OUT=.scr/d6g1-impl
node .scr/h/chain.mjs "$THEMES" ${D5_SCN:-}
cat .scr/chain.log
# leave the slot clean: committed dist back, harness copy gone
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
rm -rf .scr/h
ls .scr/d6g1-impl | wc -l
