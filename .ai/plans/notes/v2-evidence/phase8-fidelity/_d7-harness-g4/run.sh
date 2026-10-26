#!/bin/bash
# D7 final re-shoot, G4 (canvases 14 Editing, 15 Annotations) - what scripts/remote-lane.sh runs in the mini's slot.
#   scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/impl/14-editing -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g4/run.sh 14 light
#   (same for 14 dark, and 15 light|dark with --fetch .scr/impl/15-annotations; 14h = s14h alone, ONLY=<ids> passes through)
# Layers (newest wins, laid in this order):
#   14 = _c10-harness-g5 (setup.sh 14: the flattened D6 harness + scr14 Alligators/s14h/i/j) <- _c10-harness-g5-edit/scr (round 10: s14i pen block, Alligators body line)
#   15 = _c10ann-harness-g5 (setup.sh: s15 groups a-f,p + s15g g1-g5, round 10) <- _d7-harness-g4/scr15/s15.mjs (= its s15 + the round-10 print "Print guides on" step, p8-c10-print)
cd "$(dirname "$0")/../../../../../.." || exit 1
N="${1:?14|14h|15}"; T="${2:?light|dark}"
H=.ai/plans/notes/v2-evidence/phase8-fidelity
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 SHOTS_OUT=.scr/impl SHOT_CHANNEL="${SHOT_CHANNEL-chrome}"
case "$N" in 14|14h) DIR=14-editing;; 15) DIR=15-annotations;; *) echo "bad canvas"; exit 2;; esac
if [ "$N" = 15 ]; then
  bash $H/_c10ann-harness-g5/setup.sh 15 || exit 1
  cp $H/_d7-harness-g4/scr15/s15.mjs .scr/s15.mjs
else
  bash $H/_c10-harness-g5/setup.sh 14 || exit 1
  cp -R $H/_c10-harness-g5-edit/scr/. .scr/
fi
( cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release 2>&1 | tail -2 )
mkdir -p .scr/impl/$DIR
# a slot's .scr survives between runs: drop this canvas's earlier shots of this theme so only fresh ones are fetched
[ "$N" = 14h ] || rm -f .scr/impl/$DIR/*-$T.png .scr/impl/$DIR/*-$T.*.png
run() {
  local out
  out=$(bun .scr/run.mjs "$@" 2>&1)
  echo "$out" | grep -E "^shot|FAIL|RUN ERROR|pageerrors|^INSTANCE|^PEN|^TEXT-EDIT"
  if ! echo "$out" | grep -q '^shot'; then echo "NO SHOTS:"; echo "$out" | tail -15; fi
}
case "$N" in
14)
  # the D6 order first (every id), then the round-8/10 scripts so their shots win
  for s in s14a s14b s14c; do
    echo "== $s studio $T"; run .scr/$s.mjs $T
    echo "== $s gators $T"; FX=gators run .scr/$s.mjs $T
  done
  for s in s14e s14f s14g s14ai s14t; do echo "== $s $T"; run .scr/$s.mjs $T; done
  # c8/c10 chain: s14b (studio) contributes ONLY ed-obj-multi
  mkdir -p .scr/impl/_d7-keep; rm -f .scr/impl/_d7-keep/*; cp .scr/impl/$DIR/*-$T.png .scr/impl/_d7-keep/ 2>/dev/null
  echo "== s14b studio (obj-multi only) $T"; run .scr/s14b.mjs $T
  mv ".scr/impl/$DIR/ed-obj-multi-$T.png" .scr/impl/_d7-keep/ed-obj-multi-$T.png 2>/dev/null
  cp .scr/impl/_d7-keep/*-$T.png .scr/impl/$DIR/ 2>/dev/null
  for s in s14h s14i s14j; do echo "== $s $T"; run .scr/$s.mjs $T; done
  echo "== s14e (c8) $T"; FX= run .scr/s14e.mjs $T
  echo "== s14g (c8) $T"; run .scr/s14g.mjs $T
  ;;
14h)
  echo "== s14h $T"; run .scr/s14h.mjs $T
  ;;
15)
  for g in a b c d e f p; do echo "== s15 G=$g $T"; G=$g run .scr/s15.mjs $T; done
  for g in g1 g2 g3 g4 g5; do echo "== s15g G=$g $T"; G=$g run .scr/s15g.mjs $T; done
  ;;
esac
# leave the slot clean for the next user
git checkout -- apps/studio/dist 2>/dev/null
rm -f apps/studio/dist/maude-darwin-arm64
echo "D7-G4-DONE $N $T: $(ls .scr/impl/$DIR/*-$T.png 2>/dev/null | wc -l) frames"
