# AI describes the result — rule `00/rule/ai-describes-the-result` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§4).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-ai-run-model.test.ts` — "\"Done — <artboard> is <result>.\" in the contract's shape" (never the model's own voice)
- `apps/studio/test/v2-chat-undo.test.tsx` — "a click undoes the chat once and reports it" · "an undo of the run clears it … ⇧⌘Z of that undo marks it again" (⌘Z undoes AI's changes too)

## Fidelity pairs
- `01/cf-undo-ai` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/01-create-flow/cf-undo-ai-light.jpg
