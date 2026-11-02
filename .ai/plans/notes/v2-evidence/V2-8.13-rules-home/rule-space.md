# Space — rule `00/rule/space` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/space-tap.test.ts` — "the line is 200 ms" · "released in 80 ms: a tap" · "released at exactly 200 ms is a hold; 199 ms is still a tap" · "a drag while it is down cancels the tap"
- `apps/studio/test/space-tap-lane.test.ts` — "from the active canvas it plays once per tap" · "another window, another origin: nothing plays"

## Fidelity pairs
- `07/ve-play` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/07-video-editing/ve-play-light.jpg
