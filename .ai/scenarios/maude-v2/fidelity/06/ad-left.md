# 06/ad-left — Canvases and Layers › Advanced

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-left.jpg`
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-layers.jpg`
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/before-G1-ad-left-clipped.jpg`
- test: `apps/studio/test/v2-left-panel-adv-overflow.test.ts`
- test: `apps/studio/test/v2-canvases-panel-render.test.tsx`

## Checked
- Canvases: Show file names, Show hidden files, Open canvas (path with an ellipsis), Folder + Copy, Trash Empty/Open, "N of N shown · updated …" + Refresh. Layers: Show tags and ids, On this canvas, Select by selector, Element id + Copy.
- FOUND AND FIXED here (S11.9 carried them): G1 the folder path widened the grid to 856 px and clipped the switches out of the 228 px panel (before-G1 frame); G5 the open-canvas path had no ellipsis; the foot must keep wrapping.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
