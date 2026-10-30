# 06/ad-inspector — Inspector › Advanced (element half)

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-inspector.jpg`
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-inspector-b.jpg`
- test: `apps/studio/test/v2-inspector-advanced.test.tsx`
- test: `apps/studio/test/v2-advanced-rows.test.ts`

## Checked
- One quiet "Advanced · Code, tokens, CSS" row. Open: Element (Tag, Selector, Element id), position/fill/font readout, the raw CSS and attribute rows, the token/override/inherited legend, Copy style · Paste style · Copy CSS · Copy code.

## Open
- The long selector wraps over four lines; fine at 264 px, worth a look at the next copy pass.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
