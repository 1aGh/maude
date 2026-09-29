#!/bin/bash
R=$(cd "$(dirname "$0")" && pwd); S=$(dirname "$R")/e2e
for i in 1 2 3; do
  P=$R/proj/exp1-run$i; rm -rf $P; mkdir -p $P/.design
  cp -R $S/exp1-proj/.design/ui $S/exp1-proj/.design/config.json $S/exp1-proj/.design/ui-board.annotations.svg $P/.design/
  PID=$($R/boot-shipped.sh $P 4761 $R/raw/exp1-server-run$i.log)
  for k in $(seq 1 40); do curl -s -o /dev/null http://localhost:4761/_health && break; sleep 0.5; done
  echo "run $i pid $PID load: $(sysctl -n vm.loadavg)"
  node $R/exp1-comments.mjs 4761 $P $R/raw/exp1-run$i.json 2>&1 | grep -E 'result|composer|WS SENT' 
  kill $PID; sleep 1; rm -f $P/.design/_server.json
done
