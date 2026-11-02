#!/bin/bash
# round 7c chain for canvas 09: waits for the 10 chain, then ex-print-warn (t09w), ex-offline (vid), ex-history (t09p), both themes
cd "$(dirname "$0")" || exit 1
rm -f chain09c.done
until [ -f ../g4/chain10c.done ]; do sleep 5; done
for th in dark light; do
  ./go.sh t09w $th > t09w-$th.log 2>&1
  ./go.sh vid $th > vid-$th.log 2>&1
  ./go.sh t09p $th > t09p-$th.log 2>&1
done
echo done > chain09c.done
