# Share links in the native desktop app

**Persona:** Project owner sharing a canvas and following file links.
**Plan:** `.ai/plans/feature-share-link-deeplink.md`.
**Runner:** `apps/desktop/e2e/scenarios/share-link.e2e.ts` (WebdriverIO, bundled debug app).

## Platforms

Native desktop is required. Web desktop/mobile are covered by `share-link-web`.
iOS and Android native are N/A: Maude has no native mobile shell.

## Preconditions

Build the test app and use the existing `fixtures/project` with Smoke and Export.
Use an unused WebDriver port and a distinct test bundle identity when another
worktree has an app running. Select the main window explicitly. No mock clipboard.

## Steps

1. Open Smoke and open Share from the topbar. Expect the exact app URL
   `maude://open/project?open=ui/Smoke.tsx`.
2. Put a sentinel in the clipboard, click Copy, and verify the real clipboard
   contains the app URL. Do not depend on the transient Copied label.
3. Open Export's row actions and Share. Expect Export's link while Smoke stays open.
4. Deliver a same-project file event. Expect Export to open without a decision modal.
5. Deliver a foreign-project event. Expect a decision modal and Export unchanged.
6. Deliver another event while that decision is pending. Expect the original
   decision and active file to remain unchanged. Dismiss the decision.
7. Deliver a link containing both open and code. Expect no connect/file decision
   and no change to Export.

## Acceptance and evidence

All three automated tests pass. Save screenshots under
`.ai/device/scenario-runs/share-link/<run>/native-desktop/` and a report at the run root.
Actual OS scheme registration of the signed release remains a release smoke check.
