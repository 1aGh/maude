# One verb per dialog, one action per toast — rule `00/rule/one-verb-per-dialog-one-action-per-toast` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§4).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-words-lint.test.ts` — "a dialog whose title and primary button use different verbs is flagged" · "a toast with two actions is flagged" · the whole-tree run is zero hits
- `apps/studio/test/v2-ds-edges.test.tsx` — line 397: "Move “Accent” to the trash?" with the primary Move to trash
- `apps/studio/test/v2-ai-chat-list-ui.test.tsx` — describe "Move to trash": dialog title and confirm share the verb

## Fidelity pairs
- `11/pn-trash` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/11-projects-and-navigation/pn-trash-light.jpg
