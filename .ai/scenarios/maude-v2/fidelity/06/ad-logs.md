# 06/ad-logs — Diagnostics: Logs

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-logs.jpg`
- test: `apps/studio/test/v2-diagnostics-s11-11.test.ts`

## Checked
- Source filter (All · Sync · Server · AI · Export), Filter field, Refresh, Copy all; mono lines; foot "Kept 7 days on this Mac · Help › Report a bug can attach the last 200 lines." Show in Finder is drawn only in the Mac app (hidden in a browser, by design).

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
