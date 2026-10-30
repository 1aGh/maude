#!/bin/bash
# round 7b chain for canvas 09: t09 (all ids; only the touched ones are kept by pairs.mjs ONLY=…), then ho for ex-handoff
cd "$(dirname "$0")" || exit 1
rm -f chain4.done
for th in dark light; do
  ./go.sh t09 $th > t09-$th.log 2>&1
  ./go.sh ho $th > ho-$th.log 2>&1
done
echo done > chain4.done
