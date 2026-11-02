# 06/ad-why — There is no global "Advanced mode"

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- no frame
- test: `apps/studio/test/v2-no-advanced-mode.test.ts`

## Checked
- No registry id, label, alias, Settings row, section, pref or fold id matches /advanced.?mode(?![a-z])/i. Red first with an injected fold id.
- One ⌘K alias, "advanced mode" on `view.advanced-open-all`, stays on purpose: a search route to the one-shot command, not a setting.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
