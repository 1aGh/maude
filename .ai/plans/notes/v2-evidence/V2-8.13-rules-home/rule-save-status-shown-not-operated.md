# Save status, shown not operated — rule `00/rule/save-status-shown-not-operated` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§6).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-save-status.test.ts` — every word of CONTRACT §6 reachable (Saved · Syncing… · Offline — kept on this Mac · Local project), the precedence, and a person without edit rights
- `apps/studio/test/share-cluster.test.tsx` — "the status word, one per state, with its testid"
- `apps/studio/test/v2-rules-home-pins.test.tsx` — NEW (red-first): "the pill is the name, the canvas and a caret: no dot, no status word, no save state" · "the save word lives in the Share cluster, not in the pill module"

## Fidelity pairs
- `01/cf-status-words` is built in the ledger, so no fidelity pair is claimed for it
