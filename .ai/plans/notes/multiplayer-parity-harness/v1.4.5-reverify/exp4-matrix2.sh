#!/bin/bash
cd "$(dirname "$0")"; export NOWARM=1
for spec in "4791 0 m b48 C3" "4791 0 wm b48 C3" "4791 0 m b48 C0" "4791 0 m b48 CX"; do set -- $spec
  echo "== $4 $3 $5 load: $(sysctl -n vm.loadavg)"
  PARTS=$3 node exp4-safari.mjs --port $1 --cond $5 --runs 3 --fit $2 --out raw/exp4-$4-$3-$5$([ "$5" != C3 ] && echo -rerun).json 2>&1 | grep -v '^click' | cut -c1-700
done; echo DONE
