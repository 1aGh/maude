#!/bin/bash
# Round 10 (p8-c10-misc): 12 · ia-brand-steps only (s12g), both themes. Repo root = the checkout / mini slot it runs in.
#   scripts/remote-lane.sh --slot auto --max 1800 --fetch .scr/impl/12-import-and-assets -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10m-harness-g4/chain12g.sh
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT=$PWD
H=$ROOT/.ai/plans/notes/v2-evidence/phase8-fidelity/_c10m-harness-g4
export SHOT_CHANNEL=${SHOT_CHANNEL-chrome}
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
rm -rf "$ROOT/.scr/impl/12-import-and-assets"
mkdir -p "$ROOT/.scr/impl/12-import-and-assets"
(cd "$ROOT/apps/studio" && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
cd "$H" || exit 1
node run.mjs s12g.mjs ${THEMES:-dark,light} 2>&1 | tail -8
cd "$ROOT" || exit 1
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
ls "$ROOT/.scr/impl/12-import-and-assets" | wc -l
