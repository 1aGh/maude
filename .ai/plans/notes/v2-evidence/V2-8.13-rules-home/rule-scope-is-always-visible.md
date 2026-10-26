# Scope is always visible — rule `00/rule/scope-is-always-visible` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/v2-export-sheet.test.tsx` — "⇧⌘E with nothing selected opens This canvas — never the project" · "nothing selected → This canvas, with every count and \"—\" for the empty one" · "a selection opens Selection; a canvas-only session has Folder and Whole project off"

## Fidelity pairs
- `09/ex-canvas` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/09-export/ex-canvas-light.jpg
