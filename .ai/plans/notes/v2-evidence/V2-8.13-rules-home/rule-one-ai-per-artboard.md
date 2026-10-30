# One AI per artboard — rule `00/rule/one-ai-per-artboard` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/ai-runs-registry.test.ts` — "R7: two of your chats on P and S of one file → two runs, two leases" (different artboards side by side) · "R8: c2 waits behind c1 on P and starts by itself when c1 is done" · "R6: a whole-canvas ask with two artboards busy runs on the 13 free; each busy one continues by itself" · "R12: Keep going while the artboard is busy waits in line"
- `apps/studio/test/ai-run-copy.test.ts` — "R9: a waiting ask runs at once on a copy of the accepted artboard; its ticket leaves the line" · "one copy per ask" · the two races

## Fidelity pairs
- `03/ai-queue-rule` is built in the ledger, so no fidelity pair is claimed for it
