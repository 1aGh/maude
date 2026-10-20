#!/bin/bash
# S11.19 proposed ledger writes (the lead runs them after merge; <SHA> = the merge commit).
# `verified` rows point at their primary frame, `built` rows at the fidelity note that says what is left.
# 06/ad-map stays built until the lead re-runs probe-reach.mjs and the nothing-deleted gate prints 100 %.
cd "$(dirname "$0")/../../../.." || exit 1
node scripts/v2-ledger.mjs set 05/es-all-trashed built --evidence .ai/scenarios/maude-v2/fidelity/05/es-all-trashed.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-arriving built --evidence .ai/scenarios/maude-v2/fidelity/05/es-arriving.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-artboard-new built --evidence .ai/scenarios/maude-v2/fidelity/05/es-artboard-new.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-canvas-ai built --evidence .ai/scenarios/maude-v2/fidelity/05/es-canvas-ai.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-canvas-three built --evidence .ai/scenarios/maude-v2/fidelity/05/es-canvas-three.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-edge-panels built --evidence .ai/scenarios/maude-v2/fidelity/05/es-edge-panels.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-landing built --evidence .ai/scenarios/maude-v2/fidelity/05/es-landing.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-offline-uncached built --evidence .ai/scenarios/maude-v2/fidelity/05/es-offline-uncached.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-panels-canvas built --evidence .ai/scenarios/maude-v2/fidelity/05/es-panels-canvas.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-search-k verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/es-search-k-noresults.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-search-panel built --evidence .ai/scenarios/maude-v2/fidelity/05/es-search-panel.md --commit <SHA>
node scripts/v2-ledger.mjs set 05/es-viewer built --evidence .ai/scenarios/maude-v2/fidelity/05/es-viewer.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-ai built --evidence .ai/scenarios/maude-v2/fidelity/06/ad-ai.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-code verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-code.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-diag verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-diag-server.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-edge-hub verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-edge-hub.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-edge-remember verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-left.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-edge-sync built --evidence .ai/scenarios/maude-v2/fidelity/06/ad-edge-sync.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-edge-syntax verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-edge-syntax.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-edge-where built --evidence .ai/scenarios/maude-v2/fidelity/06/ad-edge-where.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-history verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-history.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-inspector verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-inspector.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-left verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-left.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-logs verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-logs.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-map built --evidence .ai/scenarios/maude-v2/fidelity/06/ad-map.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-menus verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-menus.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-open-all verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-open-all.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-pinned verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-pinned.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-search verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-search.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-settings verified --evidence .ai/plans/notes/v2-evidence/S11.19-shots/ad-settings.jpg --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-share built --evidence .ai/scenarios/maude-v2/fidelity/06/ad-share.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-syncd built --evidence .ai/scenarios/maude-v2/fidelity/06/ad-syncd.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-trace built --evidence .ai/scenarios/maude-v2/fidelity/06/ad-trace.md --commit <SHA>
node scripts/v2-ledger.mjs set 06/ad-why verified --evidence .ai/scenarios/maude-v2/fidelity/06/ad-why.md --commit <SHA>
