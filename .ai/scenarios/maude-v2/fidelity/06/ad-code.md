# 06/ad-code — The canvas as code, read-only

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-code.jpg`
- test: `apps/studio/test/v2-code-view.test.tsx`
- test: `apps/studio/test/v2-left-panel-adv-overflow.test.ts`

## Checked
- Path, "Read only" chip, Copy, ×; "Artboard ahoj-0 is marked · lines 7–9" with the lines highlighted; foot "Advanced · Terminal and Claude Code commands for this canvas".
- FOUND AND FIXED: G3 the card pinned itself 16 px from the top at z 12, so Copy and × sat under the Share cluster and the right panel hid the code. It now starts below the cluster and stacks above the docks.

## Open
- Open in editor is drawn only in the Mac app.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
