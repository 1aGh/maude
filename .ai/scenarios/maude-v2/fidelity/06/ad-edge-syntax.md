# 06/ad-edge-syntax — A canvas that cannot be drawn

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-edge-syntax.jpg`
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-edge-syntax-open.jpg`
- test: `apps/studio/test/v2-code-view.test.tsx`
- test: `apps/studio/test/v2-canvas-error-card.test.tsx`

## Checked
- A canvas that throws while drawing: "broken can’t be drawn right now. The last change has a mistake the canvas can’t show. Nothing is lost; every version stays in Version history." Show details: Error, Where, Copy, Copy error, Last good version, Reload canvas. "Ask AI to fix it" is Mac-app only.

## Open
- UNVERIFIED (G6): a canvas whose source does not even parse (a missing closing tag) opened in a browser shows an empty stage and no card, state "ready". The canvas runs on its own origin, so I could not see inside it; the card is fed by the render error boundary only. Worth one look by the lead.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
