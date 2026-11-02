# runs from the slot root on the mini (remote-lane), argv: <tag> <outrel> <cellport> <browserport> [legacy]
set -u
TAG=$1; OUT=$2; CP=$3; BP=$4; LEG=${5:-}
RUN=/private/tmp/p84-$TAG-$$; mkdir -p "$RUN"; rm -rf "$OUT"
[ -n "$LEG" ] && export P84_KEEP_LEGACY=1
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 FARM_LOCAL=1 PLAYWRIGHT_BROWSERS_PATH=/Users/iagh/Library/Caches/ms-playwright
node scripts/v2-verify/p84-up.mjs "$RUN" --cell-port $CP --browser-port $BP > "$RUN.up.log" 2>&1 &
UP=$!
for i in $(seq 1 240); do [ -f "$RUN/rig.json" ] && break; kill -0 $UP 2>/dev/null || { echo "rig died"; tail -40 "$RUN.up.log"; exit 2; }; sleep 2; done
[ -f "$RUN/rig.json" ] || { echo "rig timeout"; tail -40 "$RUN.up.log"; kill $UP; exit 3; }
node scripts/v2-verify/p84-scenarios.mjs "$RUN/rig.json" "$OUT"; rc=$?
node scripts/v2-verify/p84-report.mjs "$OUT"
kill -TERM $UP; wait $UP 2>/dev/null; sleep 3; pkill -f "$RUN/"
echo "head $(git rev-parse --short HEAD), rig scripts/v2-verify/p84-*.mjs, ${LEG:+P84_KEEP_LEGACY=1 (project left at formatVersion 1)}${LEG:-project formatVersion 2}, Mac mini remote lane, $(date +%F)" > "$OUT/RUN.txt"
echo "scenarios rc=$rc"; exit 0
