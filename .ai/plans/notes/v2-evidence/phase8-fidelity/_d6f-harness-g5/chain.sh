#!/bin/bash
# D6 final re-shoot chain (merged tip after stage C round 8). usage (repo root, e.g. via scripts/remote-lane.sh):
#   bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d6f-harness-g5/chain.sh <13|13p|14|15> <light|dark>
# Release-builds the client, assembles .scr, shoots every reachable id of the canvas for ONE theme into .scr/impl/<NN-dir>/.
cd "$(dirname "$0")/../../../../../.." || exit 1
N=$1; T=$2
bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d6f-harness-g5/setup.sh "${N%p}" || exit 1
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
export SHOTS_OUT=.scr/impl
export SHOT_CHANNEL="${SHOT_CHANNEL-chrome}"
mkdir -p .scr/impl
run() {
  local out
  out=$(bun .scr/run.mjs "$@" 2>&1)
  echo "$out" | grep -E "^shot|FAIL|RUN ERROR|pageerrors"
  if ! echo "$out" | grep -q '^shot'; then echo "NO SHOTS:"; echo "$out" | tail -15; fi
}
case "$N" in
13)
  bun .scr/mk-dsconv.mjs 2>&1 | tail -5
  for g in a b c d e f g h i j k; do echo "== s13 G=$g $T"; G=$g run .scr/s13.mjs $T; done
  echo "== s13p"; run .scr/s13p.mjs $T
  echo "== s13s"; run .scr/s13s.mjs $T
  echo "== s13u"; run .scr/s13u.mjs $T
  if [ "$T" = light ]; then bun .scr/dsboard.mjs 2>&1 | tail -8; fi
  ;;
13p) # re-run of s13p alone (a random port can collide: EADDRINUSE)
  bun .scr/mk-dsconv.mjs 2>&1 | tail -2
  echo "== s13p"; run .scr/s13p.mjs $T
  ;;
14)
  # the D5 order first (every id), then the round-8 scripts (s14h/i/j + s14e/g) so their shots win
  for s in s14a s14b s14c; do
    echo "== $s studio $T"; run .scr/$s.mjs $T
    echo "== $s gators $T"; FX=gators run .scr/$s.mjs $T
  done
  for s in s14e s14f s14g s14ai s14t; do echo "== $s $T"; run .scr/$s.mjs $T; done
  for s in s14h s14i s14j; do echo "== $s $T"; run .scr/$s.mjs $T; done
  echo "== s14e (c8) $T"; FX= run .scr/s14e.mjs $T
  echo "== s14g (c8) $T"; run .scr/s14g.mjs $T
  ;;
15)
  for g in a b c d e f; do echo "== s15 G=$g $T"; G=$g run .scr/s15.mjs $T; done
  for g in g1 g2 g3 g4 g5; do echo "== s15g G=$g $T"; G=$g run .scr/s15g.mjs $T; done
  ;;
esac
echo "CHAIN-D6-DONE $N $T"
