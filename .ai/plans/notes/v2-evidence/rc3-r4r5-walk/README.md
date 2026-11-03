# r4/r5 walk in the packaged rc.2 app (#162)

- **Run:** 2026-11-03, on the MacBook, under computer-use, with Michal's "muzes" for this item.
- **App:** `Maude_2.0.0-rc.2_universal.dmg`, copied out of the read-only mounted image.
- **Isolation:** launched with a throwaway `HOME`/`XDG_CONFIG_HOME`, a signed-out stub `claude` first on `PATH`, and `MAUDE_NO_AUTO_UPDATE=1`.
- **Project:** a copy of `apps/desktop/e2e/fixtures/project` plus a generated PNG and MP4 at `/private/tmp/maude-walk-proj`. The Open dialog cannot enter the scratchpad, so it lives there.
- **Untouched:** no real project, credential or shared project. Update project was never clicked.

| Row | What was done | Result |
| --- | --- | --- |
| r4-1 / r5-2 | MP4 dropped from Assets into the Smoke artboard, then played in Edit; a video placed in Preview, then played | **PASS, with a note.** The small play button and Space both play and pause, in Edit and in Preview. The big centre ▶ on the in-artboard video only selects on the first click. |
| r4-2 / r5-1 | OS drag from Finder into Preview (PNG, then MP4); drag from Assets into the artboard in Edit (PNG, then MP4) | **PASS.** The PNG became an annotation image. The MP4 became a video reference card ("Added video reference"), not full screen. From Assets, the PNG and the MP4 both landed in the artboard. Dropping the MP4 *onto an existing Photo* is refused with "Not placed. That picture does not fit there" — the right refusal, but the wording says "picture" for a video. |
| r4-3 | Dragged the Inspector Width label | **PASS.** 480 → 603, no text selected. |
| r4-4 | Opened the Fill colour popover | **PASS.** Custom · Libraries, then Solid · Gradient · Image. |
| r4-7 | ⌘K "design system" → the empty state | **PASS.** "No design system yet" with Create a design system, which opens "Make a design system for …". The empty-state heading also shows a spec label, "MAUDE-DSH/01 design system view". **That label looks like it leaked from the board: a finding.** |
| r4-12 | Opened a canvas row's ⋯ menu, then clicked outside (canvas, artboard, shell top bar) | **FAIL.** The menu stays open, and those clicks do nothing else either: the artboard is not selected. Only Esc closes it. After Esc, clicks work normally. The f0c9a1bdd fix closes on window blur, and here the packaged WKWebView does not deliver it. |
| r4-14 | Preview, nothing selected, Esc | **PASS.** Stays in Preview. |
| r4-15 | Placed a stamp in Preview, moved it, Delete | **PASS.** |
| r4-17 | Section tool, then a drag | **PASS.** A section is drawn by the drag and the tool returns to Select. The section templates panel opens. |
| r4-18 | New sticky dragged into the section, then the section moved | **PASS.** The sticky moves with the section, so it was re-parented. |
| r5-4 | Switched Solid → Gradient → Image → Libraries | **PASS.** The popover stays open. |
| r5-5 | Dragged the left gradient stop | **PASS.** 0 % → 48 %. |
| r5-6 | Fill › Image | **PASS.** "From your assets" lists the project's images. |
| r5-8 | The canvas path on the Light / Dark pill, and the row menu | **PASS.** `.design/ui/Smoke.tsx` is on the pill, and the row ⋯ menu has Copy relative path. |
| r5-3 | Fill › Libraries | **Not verifiable here.** The project has no design system, so there were no rows to judge. No paint-kind tabs inside it. |
| r4-6 / r5-7 | Light / Dark pill | **Not verifiable here.** The fixture canvases have no Dark ("This canvas has no Dark"). |
| r4-5, r4-8, r4-9, r4-10, r4-11, r4-13, r4-16, r4-44 | — | **Not walked.** Zoom perf has its own perf gate (V2-8.8/8.14). Hub sign-in, cloud code and the https Copy link need a hub or cloud. DS conversion needs AI. The sticker drag image cannot be seen mid-drag in a screenshot. r4-44 was never reproduced. |

## Signed-in GitHub PR path (same session)

- **Setup:** the repo `iagh66/maude-git-smoke` was cloned to a temp folder; the token was stripped from the remote URL.
- **Sign-in:** opened in the test app, then Settings › Connections › GitHub › Connect, which showed a device code. Michal authorised it in Arc.
- **Result:** the app then said "Signed in, but couldn't save it securely: Platform secure storage failure: A default keychain could not be found."
- **Why:** the throwaway HOME has no keychain. This is the isolation working (the real login keychain was not touched, and no `maude-github-token` item exists), not a product bug. It does mean the path cannot be finished in a throwaway HOME. No pull request was created.

## Follow-ups

- **r4-12:** the left-panel menus must close on a click into the canvas or the shell in the packaged WKWebView. Fix with a desktop e2e.
- **"MAUDE-DSH/01 design system view":** the label in the DS empty state should go.
- **Wording:** the refusal for a video dropped onto a photo says "picture".
- **Play control:** the big centre ▶ on an in-artboard video should play on its first click, or not be drawn.
- **GitHub PR path:** run it on the fresh macOS user from the rc.2 clean-user smoke, where the real keychain is that user's own.
