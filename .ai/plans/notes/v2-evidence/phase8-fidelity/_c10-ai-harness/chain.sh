#!/bin/bash
# D6 final re-shoot chain, G2.  usage: chain.sh <03|04|06> [themes]   (run from anywhere; runs at the repo root)
#   scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d6/<NN>-<dir> -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10-ai-harness/chain.sh 03
# Impl frames land in .scr/d6/<NN>-<dir>/<id>-<theme>.jpg; the pairs are built LOCALLY (mkpairs.sh).
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_c10-ai-harness
NN="${1:?03|04|06}"
THEMES="${2:-dark,light}"
ROOT="$PWD"
export D5_REPO="$ROOT" D5_BUN="$(command -v bun)" NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 SHOT_CHANNEL="${SHOT_CHANNEL:-chrome}" NO_MAGICK=1
export SHOTS_OUT="$ROOT/.scr/d6"
rm -rf .scr/impl .scr/attach .scr/fxcache .scr/fx-cache "$SHOTS_OUT" .scr/agent.log
mkdir -p .scr "$SHOTS_OUT"
cp -R "$H/impl" .scr/impl
cp -R "$H/fixtures/attach" .scr/attach
echo "== build $(git rev-parse --short HEAD) $(date +%T)"
( cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release 2>&1 | tail -3 )
cd .scr/impl || exit 1
run() { echo "=== $1 $2 $(date +%T)"; node run.mjs "$1.mjs" "${2:-$THEMES}" 2>&1 | grep -v "^ \|Call log\|WARNING\|^$\|^skip" | cut -c1-400; }
case "$NN" in
  03) for s in s03a s03e s03d s03c s03n s03g s03h s03i s03k s03z; do run $s; done ;;
  04) for s in s04a s04c; do run $s; done
      SHOT_CHANNEL=chrome run s04v
      for s in s04d s04k s04i; do run $s; done ;;
  04i) run s04i ;;
  03x) for s in s03e s03h; do run $s; done ;;
  06) node mk-dsconv.mjs 2>&1 | tail -3
      for s in s06b s06f s06d s06e s06g s06h s06i; do run $s; done ;;
esac
echo "CHAIN-DONE $NN $(date +%T)"
ls "$SHOTS_OUT"/*/ | wc -l
