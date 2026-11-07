#!/bin/bash
# The benchmark matrix + the prototype A/B, sequential (never two suites at once).
# usage: matrix.sh <phase>
R=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/perf-rl
V="$R/variants.sh"
BASEWT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a2735bcc7ca654c2b
PROTOWT="$R/wt-proto"
case "$1" in
  chromium)
    bash "$V" chromium cm "base" --repeat 4
    bash "$V" chromium cmfit "base" --repeat 4 --fit-all
    bash "$V" chromium cv "sceneresetvar nofilter boxshadowreset noscene cv"
    ;;
  ab)
    # interleaved: base, proto, base, proto — per engine × view
    for eng in chromium safari; do
      for view in studio fit; do
        extra=(--repeat 4); [ "$view" = fit ] && extra+=(--fit-all)
        for round in 1 2; do
          WT="$BASEWT" PROJ=proj bash "$V" "$eng" "ab-$eng-$view-r$round-main" "base" "${extra[@]}"
          WT="$PROTOWT" PROJ=proj2 bash "$V" "$eng" "ab-$eng-$view-r$round-proto" "base" "${extra[@]}"
        done
      done
    done
    ;;
esac
echo finished
