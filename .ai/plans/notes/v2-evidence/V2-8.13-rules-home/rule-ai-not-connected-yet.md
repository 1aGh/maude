# AI not connected yet — rule `00/rule/ai-not-connected-yet` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-ai-needs-you.test.tsx` — line 309: the first use opens one sheet — "Connect your Claude account to let AI draft this."
- `apps/studio/test/v2-empty-canvas.test.tsx` — "not connected: the line never changes (CONTRACT §6) — only the ask knows"
- `apps/studio/test/v2-empty-canvas-ui.test.tsx` — "not connected: the line is the same words as ready" · "S5 ConnectSheet: Connect runs the flow, Cancel closes"

## Fidelity pairs
- `02/ob-ai-connect` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/02-onboarding/ob-ai-connect-light.jpg
