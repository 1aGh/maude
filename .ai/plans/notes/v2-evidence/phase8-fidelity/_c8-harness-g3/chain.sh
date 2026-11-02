#!/bin/bash
# usage: chain.sh <07|08|09>  — run from anywhere; the whole canvas, light + dark, scenarios layered in the order the rounds changed them
# (later scenarios overwrite the ids they re-shoot). Frames land in <repo>/.scr/c8-g3/impl/<NN>/<id>-<theme>.jpg.
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g3
NN="$1"
mkdir -p .scr/c8-g3
rm -rf ".scr/c8-g3/impl/$NN" .scr/c8-g3/tmp
case "$NN" in
  07) THEMES="light dark"; SCNS="t07 t07c" ;;
  08) THEMES="dark light"; SCNS="t08" ;;
  09) THEMES="dark light"; SCNS="t09b vid adv" ;;
  *) echo "bad canvas"; exit 2 ;;
esac
for th in $THEMES; do
  for s in $SCNS; do
    node $H/shoot.mjs "$s" "$th"
  done
done
rm -rf .scr/c8-g3/tmp
echo "CHAIN $NN DONE: $(ls .scr/c8-g3/impl/$NN | wc -l) frames"
