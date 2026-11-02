#!/bin/bash
# round 7 third pass (p8-c7-ds3): groups a (ds-edit-colour, ds-advanced), f (ds-edge-contrast), b (ds-edit-reach),
# g (ds-multi-migrate), k (ds-edge-migrate), light then dark. Shots land in .scr/impl-c7ds3/; the touched ids are
# copied into .scr/impl/ for the pairs.
cd "$(dirname "$0")/.."
OUT=.scr/impl-c7ds3
mkdir -p "$OUT"
rm -f "$OUT/chain.done"
for T in light dark; do
  .scr/lanes.sh "$OUT" "$T" a f b g k
done
mkdir -p .scr/impl/13-design-system
for id in ds-edit-colour ds-advanced ds-edge-contrast ds-edit-reach ds-multi-migrate ds-edge-migrate; do
  for T in light dark; do cp ".scr/impl-c7ds3/13-design-system/$id-$T.png" .scr/impl/13-design-system/ 2>/dev/null || echo "MISSING $id-$T"; done
done
echo done > "$OUT/chain.done"
