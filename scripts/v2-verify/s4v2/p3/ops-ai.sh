#!/bin/bash
SC=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/s4v3
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-ada3048713dd57bcb
cat > $SC/ops-ai.json <<'EOF'
{"ops":[
{"op":"resolve","ids":["s_ladkmxcm","s_slaf919j","s_86kn3fol"]},
{"op":"sticker","sticker":"project-status/group-100","x":380,"y":160,"w":120,"h":120},
{"op":"sticker","sticker":"project-status/group-101","x":820,"y":380,"w":120,"h":120},
{"op":"create","type":"sticky","x":900,"y":620,"w":200,"h":90,"text":"Tiles feel small under the bigger hero — raise them?","to":"ab:desktop"},
{"op":"create","type":"sticky","x":160,"y":600,"w":190,"h":90,"text":"Headline wraps onto the picture on narrow screens","to":"el:desktop/hero-picture"}
]}
EOF
node cli/bin/maude.mjs design annotate ui/Hero.tsx --ops $SC/ops-ai.json --rects $SC/rects-hero.json --root $SC/proj 2>&1 | head -c 700
