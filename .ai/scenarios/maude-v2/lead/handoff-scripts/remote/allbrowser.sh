set -u
T="$(mktemp -d)"; mkdir -p "$T/bin"
printf '#!/bin/sh\necho {\\"loggedIn\\":false}\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
export PATH="$T/bin:$PATH" NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_CLAUDE_BIN= PLAYWRIGHT_BROWSERS_PATH=/Users/iagh/Library/Caches/ms-playwright
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release > /dev/null 2>&1) || { echo "release build failed"; exit 2; }
bash .ai/plans/notes/v2-evidence/V2-8.5-browser-runs/job.sh "$1" apps/studio/test/e2e/*.e2e.mjs
