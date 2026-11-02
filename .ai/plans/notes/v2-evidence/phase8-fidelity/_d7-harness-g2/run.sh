#!/bin/bash
# D7 final re-shoot, G2 (canvases 06 07 08) - what scripts/remote-lane.sh runs in the mini's slot.
#   scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7 -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2/run.sh <06|07|08>
# Impl frames land in <repo>/.scr/d7/<NN>/<id>-<theme>.jpg (the --fetch path); pairs are built LOCALLY by mkpairs.sh.
#   06 = g2 (the D6b chain: every ad-* id, s06j LAST) then g3 t06v (ad-timeline on a keyframed title, round 9)
#   07 = g3 t07 t07c t07v      08 = g3 t08 t08m t08p
cd "$(dirname "$0")/../../../../../.." || exit 1
NN="${1:?06|07|08}"
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2
OUT=.scr/d7/$NN
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
rm -rf "$OUT"; mkdir -p "$OUT"
case "$NN" in
  06)
    bash $H/g2/chain.sh 06
    cp .scr/d6b/06-advanced/*.jpg "$OUT"/
    ( cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release > /dev/null 2>&1; echo "build exit $?" )
    bash $H/g3/chain.sh 06-advanced
    cp .scr/d6-g3/impl/06-advanced/ad-timeline-*.jpg "$OUT"/
    ;;
  07|08)
    ( cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release > /dev/null 2>&1; echo "build exit $?" )
    bash $H/g3/chain.sh "$NN"
    cp .scr/d6-g3/impl/$NN/*.jpg "$OUT"/
    ;;
  *) echo "bad canvas"; exit 2 ;;
esac
echo "D7 $NN: $(ls "$OUT"/*.jpg | wc -l) frames"
# leave the slot clean for the next user
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
