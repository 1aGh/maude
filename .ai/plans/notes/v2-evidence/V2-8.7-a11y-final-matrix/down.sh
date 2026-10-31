#!/bin/bash
W=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y
for p in fix empty ds fmt3 kbp home; do [ -f "$W/$p.pid" ] && kill "$(cat "$W/$p.pid")" 2>/dev/null; done
pkill -f "http.server 4441"
AGENT_BROWSER_SOCKET_DIR=/private/tmp/mab-a11y agent-browser close --all 2>&1 | tail -1
sleep 2
pgrep -fl "server.ts --root|server.ts --home" | head
echo down
