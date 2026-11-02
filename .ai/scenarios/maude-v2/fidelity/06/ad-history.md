# 06/ad-history — Version history › Advanced: the git, in plain words

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-history.jpg`
- test: `apps/studio/test/v2-git-advanced.test.tsx`
- test: `apps/studio/test/v2-git-model.test.ts`
- test: `apps/studio/test/v2-left-panel-adv-overflow.test.ts`

## Checked
- Compare pictures, Project / branch, Branch, "Not in a version yet", "Everything is in a version.", every version with its id and age. Read-only note: saving and publishing are in the terminal.
- FOUND AND FIXED: G2 `.v2-fold-body` (every panel fold) was a grid with an auto column, so the widest nowrap child pushed the project and branch values, the notes and the version times out of the 264 px panel.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
