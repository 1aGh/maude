# Design system screen: #224 + #225

**Owner:** Michal (via keeper, 2026-11-12) · **Lead:** Maude v2 session · **Target:** next patch after 2.2.0. Push, tag and release need Michal's OK.

## Issues

- **#224 — Left panel won't scroll while the design system is open.**
  - Canvas: `.design/system/studyfi-v3/design-system.tsx`.
  - Report: maude-reports `r-85c07810` (2 screenshots, logs).
- **#225 — Top bar sits in a different place on the design system than on canvases.**
  - Canvas: `.design/system/alligators/design-system.tsx`.
  - Report: `r-f6c67908`.
  - Related: #217 (91a3f20df…269ffba53) moved the canvas theme pill into the shell's free top band, with the path on its own line above the controls.
  - The Design system canvas draws its own bar (`apps/studio/ds/board/ds-bar.tsx`, "kept in step" with the pill), still centred on the frame.
  - Unify the DS screen with the canvas screen: no new special case.

## Tasks

- [ ] **D1** #224: root cause and fix, with a fail-first regression test.
- [x] **D2** (65a62bf39) #225: the DS bar uses the same placement as the canvas pill (and the same component or layout where possible). Fix with a fail-first test, plus a pin that the top bar sits at the same position on the DS canvas as on a canvas.
- [ ] **D3** Gates, release bundle, mini suites. Affected desktop e2e lanes run only with the no-dialog env, and heavy lanes on the mini where possible.
- [ ] **D4** Comment on each issue with its commit. Release only with Michal's OK.

## Acceptance Criteria

- [ ] #224 fixed with a fail-first test.
- [x] #225 fixed with a fail-first test and a position pin (DS vs canvas). — 65a62bf39: the DS bar renders the pill's CanvasTopIsland; board.css copy removed.
- [ ] Gates + suites green; no dialogs; real config untouched; Michal's projects only read (repro on unlinked copies).
- [ ] Issues commented with their fix commit.

## Rules

Same as `.ai/scenarios/fix-bulk-2026-11-10/brief.md`.

## Progress log

- 2026-11-12: Opened from the keeper's message. main = v2.2.0 (a9e53d05a).
