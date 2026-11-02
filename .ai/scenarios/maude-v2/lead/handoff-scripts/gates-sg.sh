set -u
cd /Users/iagh/git/personal/maude/.claude/worktrees/lead-merge-2
(cd apps/studio && bunx tsc --noEmit); echo "tsc=$?"
node scripts/gen-actions.mjs --check >/dev/null; echo "gen-actions=$?"
node scripts/gen-plugin-surfaces.mjs --check >/dev/null; echo "gen-surfaces=$?"
npx biome check . --diagnostic-level=error >/dev/null 2>&1; echo "biome=$?"
bash scripts/check-import-coherence.sh >/dev/null 2>&1; echo "coherence=$?"
NO_OPEN=1 MAUDE_INDEX_DIR=$(mktemp -d) node scripts/check-client-boots-source.mjs 2>&1 | tail -1; echo "boot=$?"
git status --short apps/studio/dist | head
