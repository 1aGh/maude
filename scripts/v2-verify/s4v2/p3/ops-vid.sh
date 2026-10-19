#!/bin/bash
SC=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/s4v3
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-ada3048713dd57bcb
cat > $SC/ops-vid.json <<'EOF'
{"ops":[
{"op":"create","type":"sticky","x":120,"y":1300,"w":150,"h":90,"text":"Logo comes in too early","color":"#f4b6c2","timeRange":{"artboard":"reel","start":12,"end":15}},
{"op":"create","type":"sticky","x":120,"y":1560,"w":140,"h":90,"text":"Music drops here?","color":"#ffd966","timeRange":{"artboard":"reel","start":21,"end":24}}
]}
EOF
node cli/bin/maude.mjs design annotate ui/Site.tsx --ops $SC/ops-vid.json --rects $SC/rects.json --root $SC/proj 2>&1 | head -c 500
