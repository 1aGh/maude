# 06/ad-edge-sync — A sync problem, in words, with one next step

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- no frame
- test: `apps/studio/test/v2-sync-stuck-callout.test.tsx`
- test: `apps/studio/test/v2-callouts.test.tsx`

## Checked
- The callout and its fold are covered by tests.

## Open
- Needs a linked project in a stuck state to shoot.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
