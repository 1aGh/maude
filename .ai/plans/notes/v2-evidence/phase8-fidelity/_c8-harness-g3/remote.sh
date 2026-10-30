#!/bin/bash
# usage: remote.sh <07|08|09>  — what scripts/remote-lane.sh runs in the mini's slot: release-build the client, then the canvas chain.
cd "$(dirname "$0")/../../../../../.." || exit 1
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release > /dev/null 2>&1; echo "build exit $?")
bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g3/chain.sh "$1"
# leave the slot clean for the next user
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
