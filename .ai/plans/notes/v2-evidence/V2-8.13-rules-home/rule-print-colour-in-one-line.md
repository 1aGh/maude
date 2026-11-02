# Print colour, in one line — rule `00/rule/print-colour-in-one-line` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-export-print.test.tsx` — line 477: "RGB — the print shop converts to CMYK."
- `apps/studio/test/v2-inspector-print.test.tsx` — line 182: insp-pr-colour reads the same line
- `apps/studio/test/v2-rules-home-pins.test.tsx` — NEW (red-first): "CMYK is only ever said in the one sentence" — a source scan of every string under client/v2

## Fidelity pairs
- `08/ak-print-letak` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/08-artboard-kinds/ak-print-letak-light.jpg
- `09/ex-print` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/09-export/ex-print-light.jpg
