# 06/ad-edge-where — Where a tool lives, per context

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- no frame
- test: `apps/studio/test/v2-where-matrix.test.ts`

## Checked
- The 10 rows × 5 contexts matrix is data with a test (hidden · swap · greyed · read-only).

## Open
- Cloud-browser and Can-view contexts are not reachable on a local project.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
