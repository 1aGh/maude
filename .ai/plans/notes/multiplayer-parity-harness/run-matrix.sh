#!/bin/bash
# Sequential exp2 matrix. Usage: run-matrix.sh <throttle> <engine>
cd "$(dirname "$0")"
T=${1:-1}; ENG=${2:-chromium}
for C in C0 C1 C2 C3 C4; do
  echo "== $C t$T $ENG load: $(sysctl -n vm.loadavg)"
  node exp2-presence.mjs --port 4712 --cond $C --runs 3 --throttle $T --engine $ENG --fit ${FIT:-0} --out raw/exp2-$C-$ENG-t$T${FIT:+-fit}.json 2>&1 | grep -v '^$' | cut -c1-600
done
