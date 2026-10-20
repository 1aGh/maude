# 05/es-artboard-new — An empty artboard: the floating hint

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/es-artboard-new.jpg`
- test: `apps/studio/test/v2-artboard-canvas.test.tsx`
- test: `apps/studio/test/v2-empty-kit.test.tsx`

## Checked
- The frame shows the failing door, not the hint: no artboard can be added to a blank ⌘N canvas (G4).
- Proposed patch (canvas-edit.ts, `applyInsertArtboard`): when there is no `<DCArtboard>`, anchor on the last `<DCSection>`'s closing tag, or on `<DesignCanvas>` — then insert `<DCSection id="main" title="Main">` + the artboard — and say "Couldn’t add an artboard." in plain words. Test: a blank canvas gets one, and an unparsable file still throws.

## Open
- Stays `built` until G4 lands.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
