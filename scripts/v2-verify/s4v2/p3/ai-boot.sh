#!/bin/bash
# restart studio :4502 with the fake ACP agent; seed Hero canvas
WT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-ada3048713dd57bcb
SC=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/s4v3
kill $(lsof -ti :4502 -sTCP:LISTEN) 2>/dev/null
sleep 2
cp $SC/Hero.tsx $SC/proj/.design/ui/Hero.tsx
cat > $SC/proj/.design/ui/Hero.meta.json <<'EOF'
{"title":"Hero","platform":"desktop","designSystem":"maude","kind":"canvas","status":"draft","sections":[{"id":"hero","title":"Hero"}],"artboards":[]}
EOF
chmod +x $SC/claude-stub.sh
cd $WT
export S34_PORT=4502 S34_CDP=9404
export MAUDE_ACP_ADAPTER_ENTRY=$WT/scripts/v2-verify/S4.15-rig.mjs
export MAUDE_ACP_RUNTIME=$(which bun)
export MAUDE_CLAUDE_BIN=$SC/claude-stub.sh
export S5V_PROJ=$SC/proj S5V_WT=$WT S415_CANVAS=ui/Hero.tsx
nohup node scripts/v2-verify/s34-rig.mjs boot $SC > $SC/server.log 2>&1 &
echo $! > $SC/server.pid
sleep 7
curl -s localhost:4502/_health | head -c 80; echo
node cli/bin/maude.mjs design canvas-rects ui/Hero.tsx --root $SC/proj > $SC/rects-hero.json 2>$SC/rects-hero.err
head -c 400 $SC/rects-hero.json; echo
node cli/bin/maude.mjs design annotate ui/Hero.tsx --ops $SC/seed-hero.json --rects $SC/rects-hero.json --root $SC/proj | head -c 400
