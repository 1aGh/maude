#!/bin/bash
# Round 11 re-shoot chain (canvas 03 AI Chat: ai-done, ai-question, ai-long, ai-long-pinned), run at the repo root on the mini:
#   scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7/03-ai-chat -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_r11-harness-g1/chain.sh [themes] [scenes]
# Impl frames land in .scr/d7/03-ai-chat/<id>-<theme>.jpg; the pairs are built LOCALLY (mkpairs.sh).
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_r11-harness-g1
THEMES="${1:-dark,light}"
SCENES="${2:-s03r s03c s03h s03k}"
ROOT="$PWD"
export D5_REPO="$ROOT" D5_BUN="$(command -v bun)" NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 SHOT_CHANNEL="${SHOT_CHANNEL:-chrome}" NO_MAGICK=1
export SHOTS_OUT="$ROOT/.scr/d7"
rm -rf .scr/impl .scr/attach .scr/fxcache .scr/fx-cache "$SHOTS_OUT" .scr/agent.log
mkdir -p .scr "$SHOTS_OUT"
cp -R "$H/impl" .scr/impl
cp -R "$H/fixtures/attach" .scr/attach
cp -R "$H/fixtures/photos" .scr/photos
echo "== build $(git rev-parse --short HEAD) $(date +%T)"
( cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release 2>&1 | tail -3 )
cd .scr/impl || exit 1
run() { echo "=== $1 $2 $(date +%T)"; node run.mjs "$1.mjs" "${2:-$THEMES}" 2>&1 | grep -v "^ \|Call log\|WARNING\|^$\|^skip" | cut -c1-400; }
for s in $SCENES; do run "$s"; done
echo "CHAIN-DONE $(date +%T)"
ls "$SHOTS_OUT"/*/ | wc -l
# leave the slot clean for the next user
cd "$ROOT" || exit 1
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
