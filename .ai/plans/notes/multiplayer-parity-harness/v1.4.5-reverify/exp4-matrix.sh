#!/bin/bash
# Sequential Safari-observer matrix. Output: raw/exp4-<fixture>-<gesture>-<cond>.json
cd "$(dirname "$0")"
export NOWARM=1
run() { # port fit parts tag conds...
  local port=$1 fit=$2 parts=$3 tag=$4; shift 4
  for C in "$@"; do
    echo "== $tag $parts $C load: $(sysctl -n vm.loadavg)"
    PARTS=$parts node exp4-safari.mjs --port $port --cond $C --runs 3 --fit $fit --out raw/exp4-$tag-$parts-$C.json 2>&1 | grep -v '^click' | cut -c1-700
  done
}
run 4792 1 m heavy C0 C1 C1f C2 C3 CX
run 4791 0 m b48 C0 C1 C1f C2 C3 CX
run 4791 0 wm b48 C0 C2 C3 CX
run 4792 1 wm heavy C0 C3
echo DONE
