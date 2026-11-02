#!/bin/bash
SC=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/s4v3
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-ada3048713dd57bcb
cat > $SC/ops-print.json <<'EOF'
{"ops":[
{"op":"create","type":"sticky","x":1450,"y":1400,"w":170,"h":90,"text":"QRCODENOTEXYZ","color":"#ffd966"}
]}
EOF
node cli/bin/maude.mjs design annotate ui/Site.tsx --ops $SC/ops-print.json --rects $SC/rects.json --root $SC/proj 2>&1 | head -c 300
echo
# export print pdf WITH annotations requested
BODY='{"v":2,"spec":{"v":2,"scope":"selection","format":"pdf","canvas":"ui/Site.tsx","selection":{"artboards":["poster"]},"options":{"annotations":true}}}'
curl -s -X POST localhost:4502/_api/export-jobs -H 'content-type: application/json' -H 'origin: http://localhost:4502' -d "$BODY" | head -c 400
echo
sleep 12
curl -s localhost:4502/_api/export-jobs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s).jobs; for(const x of j.slice(0,3)) console.log(x.id,x.format,x.status,JSON.stringify(x.options||{}).slice(0,150), x.filename)})"
