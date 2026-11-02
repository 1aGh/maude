# Not here yet vs Missing — rule `00/rule/not-here-yet-vs-missing` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/asset-state.test.ts` — "linked: hub here / waiting / unknown → waiting (who when given)" · "linked: hub missing → missing" · "local project (no hub), file absent → missing"
- `apps/studio/test/asset-relink-sheet.test.tsx` — "Missing says Missing with Relink…; Waiting says whose Mac, quietly, and offers it" · "a picture that is here draws no box; Can view / Can comment see the words but no Relink…"

## Fidelity pairs
- `12/ia-missing` is open in the ledger, so no fidelity pair is claimed for it
- `07/ve-footage` is built in the ledger, so no fidelity pair is claimed for it
