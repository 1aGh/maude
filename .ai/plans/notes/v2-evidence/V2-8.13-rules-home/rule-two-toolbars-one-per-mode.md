# Two toolbars, one per mode — rule `00/rule/two-toolbars-one-per-mode` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§2).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/tool-palette.test.tsx` — describe "MODE_TOOLS / the slots per mode": "Edit: Select V · Hand H · Frame F · Shape R · Pen P · Text T · Image I · Component ⇧I · More" · "Preview: Hand · Sticky N · Comment C · Marker M · Arrow A · Shape R · Text T · Stickers E · Section S" · "Viewing: Hand → inspect · Comment; Present has no toolbar"
- `apps/studio/test/tool-keys.test.ts` — "Edit: N C M A E S switch to Preview with that tool" · "Q2 — Preview: V F P I ⇧I switch to Edit"
- `apps/studio/test/p8-c3-modes.test.ts` — describe "04 X1 - Preview draws no Edit chrome"

## Fidelity pairs
- `04/md-annotate` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/04-modes/md-annotate-light.jpg
- `04/md-edit-image` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/04-modes/md-edit-image-light.jpg
- `04/md-edit-component` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/04-modes/md-edit-component-light.jpg
