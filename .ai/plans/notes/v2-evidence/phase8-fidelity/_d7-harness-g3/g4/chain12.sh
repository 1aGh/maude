#!/bin/bash
# D7: canvas 12 (Import and Assets), every s12* scenario, both themes. Later scenarios overwrite earlier frames of the same id
# (s12c7 = round-7 keys/browse/tidy/inspector/steps/missing-gone, s12g = ia-brand-steps(+1/2/3), round-10 light-fixed logo tile).
cd "$(dirname "$0")/../../../../../../.." || exit 1
ROOT=$PWD
H=$ROOT/.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/g4
export SHOT_CHANNEL=${SHOT_CHANNEL-chrome}
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
rm -rf "$ROOT/.scr/impl/12-import-and-assets" "$ROOT/.scr/logs12"
mkdir -p "$ROOT/.scr/impl/12-import-and-assets" "$ROOT/.scr/logs12"
L=$ROOT/.scr/logs12
echo "== release build"
(cd "$ROOT/apps/studio" && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
cd "$H" || exit 1
for s in ${S12:-s12 s12b s12e s12f s12g s12h s12c7}; do
  echo "== $s"
  node run.mjs $s.mjs ${THEMES:-dark,light} > "$L/$s.log" 2>&1
  tail -3 "$L/$s.log"
done
ls "$ROOT/.scr/impl/12-import-and-assets" | wc -l
