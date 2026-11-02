#!/bin/bash
# D5 chain for canvas 10 (runs from the repo root of the checkout it is in — a Mac mini slot or a worktree).
# Later scenarios overwrite earlier frames of the same id (s10k = co-conflict/co-trashed with the Canvases panel folded, s10v = co-comment-video).
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT=$PWD
H=$ROOT/.ai/plans/notes/v2-evidence/phase8-fidelity/_d5-harness-g4
IMPL=$ROOT/.scr/impl/10-share-and-collaboration
TMPO=$ROOT/.scr/impl10/10-share-and-collaboration
export SHOT_CHANNEL=${SHOT_CHANNEL-chrome}  # the mini has no Playwright Chromium download, only Google Chrome.app; set SHOT_CHANNEL= (empty) locally for the bundled Chromium
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
rm -rf "$ROOT/.scr/impl10" "$IMPL"
mkdir -p "$TMPO" "$IMPL"
export SHOTS_OUT=$TMPO
echo "== release build"
(cd "$ROOT/apps/studio" && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
cd "$H" || exit 1
for s in ${SCNS:-s10 s10cm s10c s10d s10e s10m s10k s10v}; do
  echo "== $s"
  node run.mjs $s.mjs ${THEMES:-dark,light} > "$IMPL/$s.log" 2>&1
  tail -4 "$IMPL/$s.log"
  # h.step writes <SHOTS_OUT>/10-share-and-collaboration/<id>-<theme>.png; the direct p.screenshot calls write flat into SHOTS_OUT
  if [ -d "$TMPO/10-share-and-collaboration" ]; then
    cp "$TMPO"/10-share-and-collaboration/* "$TMPO"/
    rm -rf "$TMPO/10-share-and-collaboration"
  fi
  cp "$TMPO"/*.png "$IMPL"/ 2>/dev/null
done
ls "$IMPL" | wc -l
