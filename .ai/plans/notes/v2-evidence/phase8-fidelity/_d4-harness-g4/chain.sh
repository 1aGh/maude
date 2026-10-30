#!/bin/bash
cd "$(dirname "$0")" || exit 1
for s in s10 s10cm s10c s10d s10e s10m; do
  node run.mjs $s.mjs dark,light > $s.log 2>&1
done
echo done > chain.done
