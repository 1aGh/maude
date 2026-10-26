#!/bin/bash
# Round 11 (p8-r11-10): only the three re-shot ids of canvas 10 (co-comment-video, co-sync-offline, co-sync-back).
#   scripts/remote-lane.sh --slot auto --max 3000 --fetch .scr/impl/10-share-and-collaboration -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/run-r11-10.sh
cd "$(dirname "$0")/../../../../../.." || exit 1
export SCNS="s10r11v s10r11s"
exec bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/run.sh 10
