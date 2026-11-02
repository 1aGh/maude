# 06/ad-syncd — Sync details

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-syncd-local.jpg`
- test: `apps/studio/test/v2-sync-details.test.tsx`

## Checked
- Local-project state shot: "This project isn’t linked to the cloud, so there is nothing to sync. Everything is on this Mac."
- The linked states (moving, needs you, Keep both) are covered by the render test.

## Open
- Linked states need a hub; one frame of "needs you" is still to take.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
