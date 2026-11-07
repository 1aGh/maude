#!/bin/bash
# Finish: RSS v204 run 3, one app run per version, five-tab count per version. Sequential.
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
cd $S
rm -rf rss/rss-v204-r3 rss/rss-v204-r3.stdout
# RSS runner with RUNS=1 writes r1; run it under a separate tag and rename after
BIN=1 CANV=120 IDLE=300 RUNS=1 TAG=rss3 ORDER="204" ./rss-ab.sh
mv rss/rss3-v204-r1 rss/rss-v204-r3 && mv rss/rss3-v204-r1.stdout rss/rss-v204-r3.stdout
echo "== display $(pmset -g assertions | grep -c 'UserIsActive *1')"
RUNS=1 TAG=app ORDER="203 204" SW=40 IDLE=300 ./app-ab.sh
./tabs-ab.sh 203 five
./tabs-ab.sh 204 five
echo CHAINDONE
