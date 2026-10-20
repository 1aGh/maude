# 05/es-canvas-ai — An empty canvas: ask AI or start

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/es-empty-canvas.jpg`
- test: `apps/studio/test/v2-empty-canvas.test.tsx`
- test: `apps/studio/test/v2-empty-canvas-ui.test.tsx`
- test: `apps/studio/test/v2-empty-canvas-mounts.test.tsx`

## Checked
- ⌘N canvas: spot art, "Your canvas is ready.", "Ask AI for a first draft, or start drawing.", the New artboard door (the Ask AI button is drawn only when the AI is set up).
- FOUND (G4): the New artboard door failed on this very canvas. The toast read "Couldn’t insert artboard — no <DCArtboard> to anchor a new artboard — scaffold a canvas first." (`applyInsertArtboard` in canvas-edit.ts needed an existing artboard). FIXED by gate-b-fix1 (see es-artboard-new): a blank canvas now gets its first artboard in a "Main" section.

## Open
- G4 landed; the door has to be shot once more on a real ⌘N canvas. Stays `built` until then.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
