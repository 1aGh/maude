# System changes arrive as a review — rule `00/rule/system-changes-arrive-as-a-review` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-ds-review-sheet.test.tsx` — "followers are ticked, left-out are not, pinned are not and say why" · "copy goldens from 13 · ds-edit-review" · "tick state and the request body" · "refusals have words, and Updated says how many stayed out"
- `apps/studio/test/v2-ds-review-host.test.tsx` — describe "the dots on a left-out canvas" (the quiet dot) · "ds.publish opens the sheet; Update sends the ticks and says how many stayed out"

## Fidelity pairs
- `13/ds-edit-review` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/13-design-system/ds-edit-review-light.jpg
- `13/ds-edit-instance` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/13-design-system/ds-edit-instance-light.jpg
