# Share links in the browser

**Persona:** A project member following a link to a canvas or previewable file.

**Platforms:** web-desktop and web-mobile. Native desktop is covered by
`apps/desktop/e2e/scenarios/share-link.e2e.ts`. iOS and Android native are skipped:
Maude has no native mobile shell.

## Preconditions

Run the changed studio on an isolated scratch project with Smoke.tsx, Export.tsx,
and a previewable text file under its design root. Use a separate temporary
cloud credential store. Test both unlinked config and a configured public hub URL.

## Steps

1. Navigate to `/?open=ui/Smoke.tsx`. The active canvas frame has that path.
2. Open Export through the tree. The URL becomes `?open=ui/Export.tsx`.
3. Back returns to Smoke; Forward returns to Export without growing history.
4. Topbar Share opens a labelled modal. The app URL identifies Export.
   Unlinked projects have no Web link row; linked projects use the configured hub origin.
5. Copy a link. Confirm success feedback and the exact copied address. Tab and
   Shift+Tab stay within the dialog; Escape closes and returns focus to Share.
6. Open File → Share link…; Escape returns focus to the File trigger.
7. Open Smoke’s tree actions → Share… while Export is open. The dialog identifies
   Smoke and the active canvas stays Export. Repeat with a previewable text file.
8. Open the text file’s URL. Its preview is visible and Share identifies that file.
9. Open a valid missing file URL: show Not here yet with an empty pane. A cloud
   shell must not auto-open its first canvas. Invalid traversal input opens nothing.
10. Repeat the dialog checks at a mobile browser viewport: fields and copy buttons
    remain reachable without horizontal dialog overflow.

## Success

Correct path at every step, no console exceptions, keyboard focus restored,
no localhost address labelled Web link. Cloud membership remains required.
