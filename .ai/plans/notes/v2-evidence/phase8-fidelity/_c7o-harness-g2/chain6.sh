#!/bin/bash
# 06 full re-shoot, round 7b: s06b (the base walk), then s06f (round-7 fixes override), s06d (ad-timeline), s06e (ad-ds).
cd "$(dirname "$0")" || exit 1
for th in light dark; do
  for s in s06b s06f s06d s06e s06g s06h s06i; do
    echo "=== $s $th"
    ./r6.sh $s $th
  done
done
echo CHAIN6-DONE
