#!/bin/bash
# C6: turn the fresh impl shots into SPEC | IMPL pairs under .ai/plans/notes/v2-evidence/phase8-fidelity/<dir>/
cd "$(dirname "$0")" || exit 1
# 08 / 09: pairs.mjs reads .scr/impl/<nn>/<id>-<theme>.jpg (the shots land there already)
ONLY=ak-convert-after,ex-social node pairs.mjs
# 10: the shots are flat in impl/; pair.mjs wants impl/<dir>/<id>-<theme>.png
mkdir -p impl/10-share-and-collaboration
for id in co-sync-offline co-comment-thread; do
  for th in dark light; do
    magick impl/$id-$th.jpg impl/10-share-and-collaboration/$id-$th.png
  done
done
node mkpairs.mjs 10-share-and-collaboration co-sync-offline,co-comment-thread
# 13: mkpairs13 walks spec/13-design-system (only ds-truth-outside is there)
for th in dark light; do magick impl/13-design-system/ds-truth-outside-$th.jpg impl/13-design-system/ds-truth-outside-$th.png; done
bun mkpairs13.mjs 13-design-system
