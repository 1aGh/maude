#!/bin/zsh
cd "$(dirname "$0")/.."
while pgrep -f "[.]scr/run.mjs" >/dev/null; do sleep 5; done
node .scr/run.mjs .scr/s11.mjs dark,light > .scr/s11.log 2>&1
node .scr/run.mjs .scr/s11e.mjs dark,light > .scr/s11e.log 2>&1
node .scr/run.mjs .scr/s11b.mjs dark,light > .scr/s11b.log 2>&1
node .scr/run.mjs .scr/s11d.mjs dark,light > .scr/s11d.log 2>&1
node .scr/run.mjs .scr/s11ds.mjs dark,light > .scr/s11ds.log 2>&1
node .scr/strip-shoot.mjs > .scr/strip.log 2>&1
node .scr/home11.mjs dark,light > .scr/home11.log 2>&1
echo done > .scr/chain11.done
