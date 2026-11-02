# 06/ad-search — ⌘K finds the hidden tools

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-search.jpg`
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/es-search-k-noresults.jpg`
- test: `apps/studio/test/v2-search-ui.test.tsx`
- test: `apps/studio/test/v2-search-empty.test.ts`

## Checked
- "copy" lists Copy file path, Copy logs, Copy code, Copy CSS, Copy element id under "Actions · 5 hidden tools", each with its where-path (Inspector › Advanced, Menu › Diagnostics › Logs, …). A query with no match says "Nothing called …. Try another word."

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
