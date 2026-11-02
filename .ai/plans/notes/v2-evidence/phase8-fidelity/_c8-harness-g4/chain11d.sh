#!/bin/bash
# D5 supplement: s11d (pn-switch-ai-keys, ⌘K > Keyboard shortcuts) — the round-7 chain7.sh named it but g1112b did not carry the file.
cd "$(dirname "$0")/../../../../../.." || exit 1
ROOT=$PWD
H=$ROOT/.ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g4
export SHOT_CHANNEL=${SHOT_CHANNEL-chrome}
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
mkdir -p "$ROOT/.scr/impl/11-projects-and-navigation"
(cd "$ROOT/apps/studio" && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release) 2>&1 | tail -2
cd "$H" || exit 1
node run.mjs s11d.mjs dark,light 2>&1 | tail -8
ls "$ROOT/.scr/impl/11-projects-and-navigation"
