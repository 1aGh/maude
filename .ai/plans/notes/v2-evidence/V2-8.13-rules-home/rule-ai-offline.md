# AI offline — rule `00/rule/ai-offline` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-ai-needs-you.test.tsx` — line 255-256: ai-queued-line reads "Queued — sends when this Mac is online." and ai-offline-line "AI is back when this Mac is online."
- `apps/studio/test/v2-empty-canvas.test.tsx` — "offline: the line keeps its first sentence and adds the S5.13 words" · "offline: still opens the chat (Ask AI always works; the prompt waits in line)"
- `apps/studio/test/v2-empty-canvas-ui.test.tsx` — "offline: adds the S5.13 line, the spot is quiet, Ask AI stays"
- `apps/studio/test/home-ask-send.test.tsx` — line 386: Home's ask shows "AI is back when this Mac is online."

## Fidelity pairs
- `01/cf-offline-create` is built in the ledger, so no fidelity pair is claimed for it
- `03/ai-not-ready` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/03-ai-chat/ai-not-ready-light.jpg
