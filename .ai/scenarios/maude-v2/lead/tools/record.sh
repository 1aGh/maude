#!/bin/bash
# V2-8.3 record from the main checkout, with an on-screen probe log and real-config mtime checks (recreated 2026-10-28 after the reboot).
S=/Users/iagh/git/personal/maude/.ai/plans/notes/v2-evidence/V2-final-records  # in the repo: a reboot wipes TMPDIR and the scratchpad
OUT=$S/rec; P=$OUT/probe
# hold until the lead says go (product freeze starts at 8.3): touch $S/rec/go
end=$(( $(date +%s) + 10800 )); until [ -f "$S/rec/go" ]; do [ $(date +%s) -gt $end ] && { echo "no go within 3 h" > "$S/rec/summary.txt"; exit 4; }; sleep 20; done
PREFS="$HOME/.config/maude/prefs.json"; APPSUP="$HOME/Library/Application Support/maude"
mt() { stat -f %m "$1" 2>/dev/null || echo absent; }
T0=$(date "+%Y-%m-%d %H:%M:%S"); P0=$(mt "$PREFS"); A0=$(mt "$APPSUP")
echo "start $(date +%T) prefs=$P0 appsup=$A0 load=$(sysctl -n vm.loadavg)" > $OUT/summary.txt
: > $OUT/probe.log
( while true; do echo "$(date +%T) locked=$(ioreg -n Root -d1 -a | grep -c CGSSessionScreenIsLocked) load=$(sysctl -n vm.loadavg | awk '{print $2}') $("$P")" >> $OUT/probe.log; sleep 10; done ) &
PR=$!
caffeinate -disu -w $$ &
cd /Users/iagh/git/personal/maude
MAUDE_E2E_RUN_DIR=$OUT/evidence-$(date +%H%M%S) MAUDE_E2E_KEEP_FRONT=1 NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 node scripts/v2-gates.mjs --record V2-8.3 > $OUT/gate.log 2>&1
RC=$?
kill $PR
P1=$(mt "$PREFS"); A1=$(mt "$APPSUP")
echo "end $(date +%T) rc=$RC prefs_moved=$([ "$P0" = "$P1" ] && echo no || echo YES) appsup_moved=$([ "$A0" = "$A1" ] && echo no || echo YES) covered=$(grep -c maude_on_screen=false $OUT/probe.log)/$(wc -l < $OUT/probe.log) locked=$(grep -c 'locked=[1-9]' $OUT/probe.log)" >> $OUT/summary.txt
T1=$(date "+%Y-%m-%d %H:%M:%S")
DARK=$(pmset -g log | awk -v a="$T0" -v b="$T1" '/Display is turned off/ { t=$1" "$2; if (t>=a && t<=b) n++ } END { print n+0 }')
echo "display_off_during_run=$DARK" >> $OUT/summary.txt
# keep the lane logs: TMPDIR does not survive a reboot
D=$(ls -dt "${TMPDIR:-/tmp}"/maude-v2-8.3/* 2>/dev/null | head -1); [ -n "$D" ] && cp -R "$D" $OUT/lanes-$(basename "$D")
exit $RC
