# 06/ad-edge-remember — Remembered folds

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-left.jpg`
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-layers.jpg`
- test: `apps/studio/test/v2-fold.test.tsx`

## Checked
- The Canvases and Layers Advanced folds stayed open through several reloads of the page; Settings › Reset › Reset Advanced sections and ⌘K Close all are the way back.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
