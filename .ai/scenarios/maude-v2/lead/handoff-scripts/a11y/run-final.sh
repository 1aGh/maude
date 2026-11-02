#!/bin/bash
# V2-8.7 — the whole a11y matrix in one pass at the freeze head ($1), in the a11y-run worktree (dist reverted after).
W=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y
REPO=/Users/iagh/git/personal/maude/.claude/worktrees/a11y-run
cd "$REPO" || exit 1
git checkout -q -- apps/studio/dist 2>/dev/null
git checkout -q --detach "$1" || exit 1
echo "head $(git rev-parse --short HEAD)"
bash "$W/build.sh"
bash "$W/up.sh" fix 4431; bash "$W/up.sh" empty 4432; bash "$W/up.sh" ds 4433; bash "$W/up.sh" fmt3 4434
bash "$W/home-up.sh"
(cd "$REPO/apps/desktop/src" && nohup python3 -m http.server 4441 --bind 127.0.0.1 > "$W/strip-http.log" 2>&1 & echo $! > "$W/strip.pid")
for p in 4431 4432 4433 4434 4440; do
  for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$p/_health" && break; sleep 1; done
done
bash "$W/final.sh" > "$W/final-$1.log" 2>&1
bash "$W/down.sh" > /dev/null 2>&1
kill "$(cat "$W/strip.pid")" 2>/dev/null
git checkout -q -- apps/studio/dist
echo "dist: $(git status --short apps/studio/dist | wc -l)"
grep -cE "serious|critical" "$W/final-$1.log"
tail -5 "$W/final-$1.log"
