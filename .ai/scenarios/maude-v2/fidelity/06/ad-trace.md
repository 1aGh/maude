# 06/ad-trace — Resync trace

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- no frame
- test: `apps/studio/test/v2-diagnostics-s11-11.test.ts`
- test: `apps/studio/test/v2-diagnostics-render.test.tsx`

## Checked
- Progress line, result sentence and the log line are covered by the model and render tests.

## Open
- Needs a project linked to a hub (a resync has nothing to do on a local project); the e2e leg joins team-project.e2e.ts. Not shot.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
