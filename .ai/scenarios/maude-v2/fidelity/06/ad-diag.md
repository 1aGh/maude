# 06/ad-diag — Diagnostics: Server and AI setup

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-diag-server.jpg`
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-diag-ai.jpg`
- test: `apps/studio/test/v2-diagnostics-render.test.tsx`
- test: `apps/studio/test/v2-diagnostics-model.test.ts`

## Checked
- The sheet has Logs · Server (Running) · AI setup (Ready) · Sync tabs, each with its word; Server shows the live connection, AI setup answers in rows.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
