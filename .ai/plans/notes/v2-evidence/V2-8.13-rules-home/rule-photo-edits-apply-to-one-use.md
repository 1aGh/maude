# Photo edits apply to one use — rule `00/rule/photo-edits-apply-to-one-use` (V2-8.13)

Source: `.design/ui/v2/00 Index.tsx` › "The rules every canvas follows" (§7).

## Tests that pin it (all green on the tip, run one file per process through the test lane)
- `apps/studio/test/photo-bridge-per-use.test.tsx` — "a use with its own edit shows it; the other use of the same picture shows every-use" · "a live preview with `use` changes that one use only"
- `apps/studio/test/photo-per-use-mixed-sync.test.tsx` — "the per-use edit arrives whole; the 1.x peer reads it as v1, shows the every-use look and keeps it"

## Fidelity pairs
- `12/ia-photo-inspector` verified (dark + light pair): .ai/plans/notes/v2-evidence/phase8-fidelity/12-import-and-assets/ia-photo-inspector-light.jpg
