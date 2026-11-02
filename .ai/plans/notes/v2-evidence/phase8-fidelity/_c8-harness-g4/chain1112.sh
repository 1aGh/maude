#!/bin/bash
# D5 chain for canvases 11 + 12 (= round-7 chain7.sh with the s11dl deeplink retake in place of the missing s11d).
# Runs from the repo root of the checkout it is in. Later scripts overwrite earlier frames of the same id.
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT=$PWD
H=$ROOT/.ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g4
export SHOT_CHANNEL=${SHOT_CHANNEL-chrome}  # the mini has no Playwright Chromium download, only Google Chrome.app; set SHOT_CHANNEL= (empty) locally for the bundled Chromium
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
T=${THEMES:-dark,light}
rm -rf "$ROOT/.scr/impl/11-projects-and-navigation" "$ROOT/.scr/impl/12-import-and-assets" "$ROOT/.scr/logs1112"
mkdir -p "$ROOT/.scr/impl/11-projects-and-navigation" "$ROOT/.scr/impl/12-import-and-assets" "$ROOT/.scr/logs1112"
L=$ROOT/.scr/logs1112
echo "== release build"
(cd "$ROOT/apps/studio" && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -3
cd "$H" || exit 1
node mkdesigncopy.mjs > "$L/mkdesigncopy.log" 2>&1
node mkhomepics.mjs > "$L/mkhomepics.log" 2>&1
rm -rf "$ROOT/.scr/home-idx"
MAUDE_INDEX_DIR=$ROOT/.scr/home-idx HOME_PICS_DIR=$ROOT/.scr/home-pics bun seed-home.ts > "$ROOT/.scr/home-seed.json" 2> "$L/seed-home.log"
for s in ${S11:-s11 s11e s11b s11dl s11r2 s11k s11c7}; do
  echo "== $s"
  node run.mjs $s.mjs $T > "$L/$s.log" 2>&1
  tail -3 "$L/$s.log"
done
echo "== s11ds7"
node run.mjs s11ds7.mjs $T > "$L/s11ds7.log" 2>&1
tail -3 "$L/s11ds7.log"
echo "== strip-shoot"
node strip-shoot.mjs > "$L/strip.log" 2>&1
tail -3 "$L/strip.log"
echo "== home11"
node home11.mjs $T > "$L/home11.log" 2>&1
tail -3 "$L/home11.log"
for s in ${S12:-s12 s12b s12e s12f s12g s12h s12c7}; do
  echo "== $s"
  node run.mjs $s.mjs $T > "$L/$s.log" 2>&1
  tail -3 "$L/$s.log"
done
cp "$L"/*.log "$ROOT/.scr/impl/11-projects-and-navigation/" 2>/dev/null
ls "$ROOT/.scr/impl/11-projects-and-navigation" | wc -l
ls "$ROOT/.scr/impl/12-import-and-assets" | wc -l
