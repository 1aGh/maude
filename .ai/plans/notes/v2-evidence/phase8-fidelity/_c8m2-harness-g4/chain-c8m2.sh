#!/bin/bash
# p8-c8-misc2 re-shoot of the ids this round touched on 11 + 12 (pn-tab-b / pn-tab-b20 / pn-switch-ai-strip / pn-relaunch-strip via the strip page,
# pn-move, pn-deeplink, ia-brand-steps -1/-2/-3). Runs from the repo root of the checkout it is in. Release-build the client first.
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT=$PWD
H=$ROOT/.ai/plans/notes/v2-evidence/phase8-fidelity/_c8m2-harness-g4
export SHOT_CHANNEL=${SHOT_CHANNEL-chrome}
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
rm -rf "$ROOT/.scr/impl/11-projects-and-navigation" "$ROOT/.scr/impl/12-import-and-assets"
mkdir -p "$ROOT/.scr/impl/11-projects-and-navigation" "$ROOT/.scr/impl/12-import-and-assets" "$ROOT/.scr/logs"
cd "$H" || exit 1
echo "== pn-move"; ONLY=pn-move node run.mjs s11c7.mjs dark,light > "$ROOT/.scr/logs/s11c7.log" 2>&1; grep -E "^shot|FAIL|ERROR" "$ROOT/.scr/logs/s11c7.log"
echo "== pn-deeplink"; node run.mjs s11dl.mjs dark,light > "$ROOT/.scr/logs/s11dl.log" 2>&1; grep -E "^shot|FAIL|ERROR|toast" "$ROOT/.scr/logs/s11dl.log"
echo "== strip"; node strip-shoot.mjs > "$ROOT/.scr/logs/strip.log" 2>&1; grep -c "^shot" "$ROOT/.scr/logs/strip.log"
echo "== ia-brand-steps"; node run.mjs s12g.mjs dark,light > "$ROOT/.scr/logs/s12g.log" 2>&1; grep -E "^shot|FAIL|ERROR|no " "$ROOT/.scr/logs/s12g.log"
echo CHAIN DONE
