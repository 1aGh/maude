#!/bin/bash
# Interleaved A/B (main vs proto), strictly sequential.
R=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/perf-rl
V="$R/variants.sh"
BASEWT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a2735bcc7ca654c2b
PROTOWT="$R/wt-proto"
for eng in safari chromium; do
  for spec in "studio r1" "studio r2" "fit r1"; do
    set -- $spec; view=$1; round=$2
    extra=(--repeat 4); [ "$view" = fit ] && extra+=(--fit-all)
    WT="$BASEWT" PROJ=proj bash "$V" "$eng" "ab-$eng-$view-$round-main" "base" "${extra[@]}"
    WT="$PROTOWT" PROJ=proj2 bash "$V" "$eng" "ab-$eng-$view-$round-proto" "base" "${extra[@]}"
  done
done
echo finished
