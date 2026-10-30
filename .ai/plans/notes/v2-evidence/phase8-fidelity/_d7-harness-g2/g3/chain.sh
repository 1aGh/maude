#!/bin/bash
# D7: 07 = t07 t07c t07v (round 9 fixtures), 08 = t08 t08m t08p (round 8 + round 10), 06-advanced = t06v (ad-timeline on a keyframed title).
# usage: chain.sh <07|08|06-advanced|09>  — run from anywhere; the whole canvas, light + dark, scenarios layered in the order the rounds changed them
# (later scenarios overwrite the ids they re-shoot). Frames land in <repo>/.scr/d6-g3/impl/<NN>/<id>-<theme>.jpg.
cd "$(dirname "$0")/../../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2/g3
NN="$1"
mkdir -p .scr/d6-g3
rm -rf ".scr/d6-g3/impl/$NN" .scr/d6-g3/tmp
case "$NN" in
  07) THEMES="light dark"; SCNS="t07 t07c t07v" ;;
  06-advanced) THEMES="light dark"; SCNS="t06v" ;;
  08) THEMES="dark light"; SCNS="t08 t08m t08p" ;;
  09) THEMES="dark light"; SCNS="t09 t09b ho vid adv t09w t09p" ;;
  *) echo "bad canvas"; exit 2 ;;
esac
for th in $THEMES; do
  for s in $SCNS; do
    node $H/shoot.mjs "$s" "$th"
  done
done
rm -rf .scr/d6-g3/tmp
echo "CHAIN $NN DONE: $(ls .scr/d6-g3/impl/$NN | wc -l) frames"
