#!/bin/bash
# Round 10 (p8-c10-misc): 10 · co-comment-video only (s10v), both themes.
cd "$(dirname "$0")/../../../../../.." || exit 1
export SCNS="s10v"
exec bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10m-harness-g4/chain10.sh
