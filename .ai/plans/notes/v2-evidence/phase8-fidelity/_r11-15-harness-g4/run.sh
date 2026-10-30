#!/bin/bash
# Round 11 (p8-r11-15) re-shoot - what scripts/remote-lane.sh runs in the mini's slot (repo-relative).
#   scripts/remote-lane.sh --slot auto --max 3000 --fetch .scr/impl/15-annotations -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_r11-15-harness-g4/run.sh 15 light   (then dark)
#   scripts/remote-lane.sh --slot auto --max 3000 --fetch .scr/impl/15-annotations -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_r11-15-harness-g4/run.sh 15v          (an-video, both themes)
#   scripts/remote-lane.sh --slot auto --max 3000 --fetch .scr/impl/12-import-and-assets -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_r11-15-harness-g4/run.sh 12      (ia-assets-find, dark)
# 15  = _c10ann-harness-g5 setup + _r11-15-harness-g4/scr15/s15.mjs (= _d7-harness-g4's with the an-follow arrows seeded Elbow), group b only
#       (an-follow, an-layers; the other ids of that group are not used)
# 15v = the g4 lib of _d7-harness-g3 (real footage: the Alligators trailer) running g4v/s15v.mjs
# 12  = _d7-harness-g3/g4/chain12.sh, scenario s12 only, dark
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT=$PWD
H=.ai/plans/notes/v2-evidence/phase8-fidelity
R=$H/_r11-15-harness-g4
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 SHOT_CHANNEL="${SHOT_CHANNEL-chrome}"
build() { ( cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release 2>&1 | tail -2 ); }
clean() { git checkout -- apps/studio/dist 2>/dev/null; rm -f apps/studio/dist/maude-darwin-arm64; }
case "$1" in
15)
  T="${2:?light|dark}"
  bash $H/_c10ann-harness-g5/setup.sh 15 || exit 1
  cp $R/scr15/s15.mjs .scr/s15.mjs
  build
  mkdir -p .scr/impl/15-annotations
  rm -f .scr/impl/15-annotations/*-$T.png .scr/impl/15-annotations/*-$T.*.png
  SHOTS_OUT=.scr/impl G=b bun .scr/run.mjs .scr/s15.mjs $T 2>&1 | grep -E "^shot|FAIL|RUN ERROR|pageerrors|^INSTANCE"
  clean
  echo "R11-15 15 $T: $(ls .scr/impl/15-annotations/*-$T.png 2>/dev/null | wc -l) frames"
  ;;
15v)
  build
  mkdir -p .scr/impl/15-annotations
  rm -f .scr/impl/15-annotations/an-video-*.png
  ( cd $H/_d7-harness-g3/g4 && SHOTS_OUT=$ROOT/.scr/impl node run.mjs $ROOT/$R/g4v/s15v.mjs dark,light 2>&1 | grep -E "ROW|FAIL|RUN ERROR|pageerrors|hype rect|^strip|annotate failed" )
  clean
  echo "R11-15 15v: $(ls .scr/impl/15-annotations/an-video-*.png 2>/dev/null | wc -l) frames"
  ;;
12)
  S12=s12 THEMES=dark bash $H/_d7-harness-g3/g4/chain12.sh
  clean
  echo "R11-15 12: $(ls .scr/impl/12-import-and-assets/*.png 2>/dev/null | wc -l) frames"
  ;;
*) echo "bad target"; exit 2 ;;
esac
