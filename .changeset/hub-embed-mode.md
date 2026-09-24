---
'@1agh/maude': minor
---

A self-hosted hub can now be embedded in another app, so a design can sit next to the task it belongs to.

Frame `https://<hub>/?open=<file>&embed=1` and the studio shows that one canvas on its own — no file tree, no toolbars, no comments, read-only, still pannable and zoomable. Add `&artboard=<id>` to frame a single artboard. The embed tells the app around it when the canvas is `ready`, when the file is `not-found`, and when the viewer needs to sign in (`auth-required`), by message to that app's exact address and to no one else. A viewer who is not signed in sees a short page with a link that opens the normal sign-in in a new tab, instead of a frame the browser refuses to show.

Nothing can frame the studio until the operator names it in `MAUDE_EMBED_ORIGINS` (or `maude hub workspace-up --embed-origin <origin>`). That list only allows framing: an embedding app gets no write access to a canvas, unlike the shell origins the hub already knew about. The studio page also now says who may frame it — before, any site could.
