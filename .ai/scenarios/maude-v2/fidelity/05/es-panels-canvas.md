# 05/es-panels-canvas — Empty panels: Canvases and Layers

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- no frame
- test: `apps/studio/test/v2-canvases-panel-render.test.tsx`
- test: `apps/studio/test/v2-empty-kit.test.tsx`

## Checked
- Covered by tests. Observation: on a blank canvas the Layers panel kept listing the previous canvas’s `div` ("0 artboards · 1 layer") — a stale list; Layers is S2’s, not changed here.

## Open
- Not shot: needs an empty project.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
