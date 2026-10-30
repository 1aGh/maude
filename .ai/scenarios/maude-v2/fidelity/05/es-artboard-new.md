# 05/es-artboard-new — An empty artboard: the floating hint

Status: **built** (S11.19, 2026-10-20; G4 fixed by gate-b-fix1, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/es-artboard-new.jpg` (the failing door, from before the fix)
- test: `apps/studio/test/v2-artboard-canvas.test.tsx`
- test: `apps/studio/test/v2-empty-kit.test.tsx`
- test: `apps/studio/test/element-structural-edit.test.ts` (applyInsertArtboard: a blank canvas gets an artboard; an unparsable file still refuses)
- test: `apps/studio/test/insert-preset.test.ts` (the AI / size-picker op on a blank canvas)

## Checked
- The S11.19 frame showed the failing door, not the hint: no artboard could be added to a blank ⌘N canvas (G4).
- G4 landed (gate-b-fix1, `applyInsertArtboard` in canvas-edit.ts): with no `<DCArtboard>` the artboard goes into the last `<DCSection>`; with no section either, into `<DesignCanvas>` inside a new `<DCSection id="main" title="Main">` (what a scaffolded canvas looks like), and the `@maude/canvas-lib` import gains `DCSection, DCArtboard`. The blank template's "Empty. Add …" comment goes. The same function serves the F size picker and the AI op (`artboard.insert-preset`, insert-shape), so all three doors work on a blank canvas.
- A file that does not parse still refuses, now in plain words: the toast reads "Couldn't add an artboard — this canvas does not parse; fix it before editing." (the shell's label was "insert artboard"). A file with no `<DesignCanvas>` refuses with "there is no canvas in this file to add an artboard to".

## Open
- The hint itself (the floating "empty artboard" state) still has to be shot on a real ⌘N canvas now that the door works; stays `built` until then.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
