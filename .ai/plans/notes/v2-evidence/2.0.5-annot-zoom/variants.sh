#!/bin/bash
# usage: variants.sh <engine> <prefix> <variant-list> [extra perf args...]
ENG="$1"; PFX="$2"; LIST="$3"; shift 3; EXTRA=("$@")
R=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/perf-rl
WT=${WT:-/Users/iagh/git/personal/maude/.claude/worktrees/agent-a2735bcc7ca654c2b}
css_of() {
  case "$1" in
    base|base2|base3) echo "" ;;
    noscene) echo ".dc-annot-scene{display:none!important}" ;;
    sceneresetvar) echo ".dc-annot-scene{--dc-zoom:initial}" ;;
    nochip) echo ".dc-annot-chip{display:none!important}" ;;
    nofilter) echo ".dc-annot-geo *{filter:none!important}" ;;
    novfx) echo ".dc-annot-geo *{vector-effect:none!important}" ;;
    nostickies) echo ".dc-annot-scene>[data-type=sticky]{display:none!important}" ;;
    noarrows) echo ".dc-annot-scene>[data-type=arrow]{display:none!important}" ;;
    nosections) echo ".dc-annot-scene>[data-type=section]{display:none!important}" ;;
    notext) echo ".dc-annot-text{display:none!important}" ;;
    filtvfx) echo ".dc-annot-geo *{filter:none!important;vector-effect:none!important}" ;;
    nofilterreset) echo ".dc-annot-geo *{filter:none!important}.dc-annot-scene{--dc-zoom:initial}" ;;
    boxshadow) echo ".dc-annot-geo *{filter:none!important}.dc-annot-scene>[data-type=sticky]{box-shadow:0 4px 14px rgba(0,0,0,.24);border-radius:4px}" ;;
    boxshadowreset) echo ".dc-annot-geo *{filter:none!important}.dc-annot-scene>[data-type=sticky]{box-shadow:0 4px 14px rgba(0,0,0,.24);border-radius:4px}.dc-annot-scene{--dc-zoom:initial}" ;;
    cv) echo ".dc-annot-scene>.dc-annot-el{content-visibility:auto}" ;;
  esac
}
for name in $LIST; do
  css="$(css_of "$name")"
  if [ -n "$css" ]; then
    bash "$R/perf.sh" "$WT" "$PFX-$name" --engine "$ENG" --studio --repeat 3 --variant "$name" --inject-css "$css" "${EXTRA[@]}"
  else
    bash "$R/perf.sh" "$WT" "$PFX-$name" --engine "$ENG" --studio --repeat 3 --variant "$name" "${EXTRA[@]}"
  fi
done
