# browser e2e for V2-8.5 on the mini; argv: <tag>
set -u
T="$(mktemp -d)"; mkdir -p "$T/bin"
printf '#!/bin/sh\necho {\\"loggedIn\\":false}\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
export PATH="$T/bin:$PATH" NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_CLAUDE_BIN= PLAYWRIGHT_BROWSERS_PATH=/Users/iagh/Library/Caches/ms-playwright
E=apps/studio/test/e2e; B=.ai/plans/notes/v2-evidence/V2-8.5-browser-runs
bash $B/job.sh "$1" $E/ai-states.e2e.mjs $E/ai-handoff.e2e.mjs $E/ai-annotations.e2e.mjs $E/annotations-viewer.e2e.mjs $E/presence-together.e2e.mjs $E/edit-together.e2e.mjs $E/video-together.e2e.mjs
cat $B/$1/summary.txt
