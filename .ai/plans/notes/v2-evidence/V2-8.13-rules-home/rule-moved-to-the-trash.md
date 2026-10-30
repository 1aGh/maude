# Moved to the trash — rule `00/rule/moved-to-the-trash` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-words-lint.test.ts` — the scanner bans "Delete" for a thing that goes to the trash across every string under client/v2 ("no banned word in anything a person can read")
- `apps/studio/test/v2-trash-view.test.tsx` — "an owner sees Clear out…, the confirm uses the contract's words" · "an editor (canClear false) sees Restore and no Clear out…" (editors move, owners empty)
- `apps/studio/test/v2-canvases-rename.test.tsx` — "⋯ opens … Move to trash — and no red ×"
- `apps/studio/test/v2-ai-chat-list-ui.test.tsx` — describe "Move to trash": the dialog asks "Move … to the trash?" and the button is Move to trash
- `apps/studio/test/v2-canvases-trash-toast.test.ts` — the done toast

## Fidelity pairs
- `10/co-share-roles` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/10-share-and-collaboration/co-share-roles-light.jpg
- `11/pn-trash` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/11-projects-and-navigation/pn-trash-light.jpg
