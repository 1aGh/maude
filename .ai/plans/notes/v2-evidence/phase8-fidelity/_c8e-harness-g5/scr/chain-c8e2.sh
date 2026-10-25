#!/bin/bash
# re-shoot ed-edge-paste + ed-inspector (both themes) after the last product fixes
cd "$(dirname "$0")/.." || exit 1
export SHOTS_OUT=.scr/impl SHOT_CHANNEL=chrome
for t in light dark; do
  bun .scr/run.mjs .scr/s14e.mjs $t 2>&1 | grep -E "^shot|FAIL|ERROR"
  bun .scr/run.mjs .scr/s14g.mjs $t 2>&1 | grep -E "^shot|FAIL|ERROR"
done
echo CHAIN2-DONE
