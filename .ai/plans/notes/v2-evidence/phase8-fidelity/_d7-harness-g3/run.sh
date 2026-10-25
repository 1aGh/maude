#!/bin/bash
# D7 final re-shoot, G3 (canvases 10 12 13) - what scripts/remote-lane.sh runs in the mini's slot (repo-relative).
#   scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/impl/<NN-dir> -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/run.sh <10|12|13> [light|dark]
# 10 / 12 = g4 (= _c10m-harness-g4, the round-10 layer of the D6 chain), both themes in one call.
# 13      = g5 (= _d6f-harness-g5 chain.sh 13: s13 groups a-k, s13p, s13s, s13u, dsboard), ONE theme per call (dsboard runs with light).
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
case "$1" in
  10) bash $H/g4/chain10.sh ;;
  12) bash $H/g4/chain12.sh ;;
  13) bash $H/g5/chain.sh 13 "${2:?light|dark}" ;;
  *) echo "bad canvas"; exit 2 ;;
esac
# leave the slot clean for the next user
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
