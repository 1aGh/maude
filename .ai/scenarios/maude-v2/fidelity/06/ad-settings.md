# 06/ad-settings — Settings › Advanced

Status: **verified** (S11.19, 2026-10-20). An implemented-state frame was looked at, and a test pins the claim.

## Evidence
- frame: `.ai/plans/notes/v2-evidence/S11.19-shots/ad-settings.jpg`
- test: `apps/studio/test/v2-settings.test.tsx`

## Checked
- This Mac (Version, Update, Local server port, Runtime, Server build, Keys are kept in), Claude Code (Plugins, Use my own plugin copy, Install and sign in automatically, copy-ready commands), Decision memory, Engines.

## Open
- After a click through a script the sidebar shows the focus ring on General while Advanced is selected; a real click moves it. Not a defect.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
