# V2-8.4 — cross-shell scenarios

Web-desktop lane of the flow `scenario-runner` approach, run through `scripts/v2-verify/p84-up.mjs` (rig) and
`scripts/v2-verify/p84-scenarios.mjs` (driver, headless Chromium 1600×1000). Three shells, the same six steps, one
canvas (`ui/board.tsx`, a real `DesignCanvas` with one artboard). The cloud tab is a LOCAL cell (`scripts/dev/local-cell.mjs`:
hub in workspace mode + its studio child, served at `studio.cell.localhost`); the viewer is a `viewer`-role session
minted into that cell's own token store, the way the studio door mints one. Nothing production, no real hub / render /
Stripe / Cloudflare; throwaway HOME, stub `claude`.

## TL;DR

**0 blockers** · 3 shells × 6 steps.

| Step | Plain browser (local studio) | Cloud tab (local cell, owner) | Cloud tab (viewer — Can comment) |
| --- | --- | --- | --- |
| Open the project | PASS | PASS | PASS |
| Open a canvas | PASS | PASS | PASS |
| Select an element and inspect it | PASS | PASS | PASS |
| Leave a comment | PASS | PASS | PASS |
| Export a PNG | PASS | PASS | PASS |
| Share sheet | PASS | PASS (P8 re-run: gap closed) | PASS (P8 re-run: gap closed) |

**Known gaps** (the step did what a person can see it do; the stand-in cannot reach the rest):

> **Both share gaps are closed (P8 cloud-share, branch `p8-cloudshare`, see "P8 re-run: cloud Share" below).** A cell's
> hub now answers `/_api/share/*` for a browser tab by the desktop's fixed map (`apps/studio/access/share-map.ts`), as
> the session the tab carries. The owner's tab loads people and sends an invitation; the viewer's Ask to edit sends.

- (closed) owner/share: the cloud-tab Share sheet cannot load people/invites on a LOCAL cell: it asks /_api/share/* (refused by the cell proxy) — the sheet says "Sharing is not available right now. Invites you send wait he…" and speaks of "this Mac".
- (closed) viewer/share: Ask to edit cannot reach a hub door from a cloud tab on a LOCAL cell: the tab asks /_api/share/requests (refused by the cell proxy, S9.21) and /api/access/requests takes a bearer, not the session cookie. Says "Ask a project owner for edit access." instead of sending.

## Parity

What each shell showed at each step (from the live page; the open-project row is checked against
`apps/studio/client/v2/shell/shell-parity.json`, the table the shell is pinned to).

| Step | Plain browser (local studio) | Cloud tab (local cell, owner) | Cloud tab (viewer — Can comment) |
| --- | --- | --- | --- |
| Open the project | table shell browser: 14 chrome testids present, 0 stray · status word: "Local project" | table shell cloud-owner: 14 chrome testids present, 0 stray · status word: "Saved" | table shell cloud-viewer: 14 chrome testids present, 0 stray · status word: "Can comment" |
| Open a canvas | rendered in localhost:62273 | rendered in canvas.cell.localhost:4799 | rendered in canvas.cell.localhost:4799 |
| Select an element and inspect it | inspector: "Card Frame esc Frame Frame Uses smoke Position X · Y X Y Rotation It sits where its frame’s layout puts it. Pl" · 14 editable input(s) in the Inspector (table readOnly=false) | inspector: "Card Frame esc Frame Frame Uses smoke Position X · Y X Y Rotation It sits where its frame’s layout puts it. Pl" · 14 editable input(s) in the Inspector (table readOnly=false) | inspector: "Card Frame Cross-shell card esc Cross-shell card Text Uses smoke Type Style Aa No style Font Inherited Size · " · 0 editable input(s) in the Inspector (table readOnly=true) |
| Leave a comment | the Comments panel holds the comment: true (1 comment(s) listed — a cell shows every shell's) · share-cluster-comments button drawn: true | the Comments panel holds the comment: true (1 comment(s) listed — a cell shows every shell's) · share-cluster-comments button drawn: true | the Comments panel holds the comment: true (1 comment(s) listed — a cell shows every shell's) · share-cluster-comments button drawn: true |
| Export a PNG | sheet: "Export “Card”" · scope selection · server job done: "board — Card@1x.png PNG · On this Mac · just now Ready" · downloaded board Card@1x.png — PNG signature ok | sheet: "Export “Card”" · scope selection · browser lane: "Saved card.png to your downloads." · downloaded card.png — PNG signature ok | sheet: "Export “Cross-shell card One canvas, three shel…”" · scope selection · browser lane: "Capturing…" · downloaded card.png — PNG signature ok |
| Share sheet | share sheet (local project: no invite): "Share board Local project — kept on this Mac. Invite people once it is in the cloud. Advanced Links, link rules, sync" | share sheet (degraded): "Share board Sharing is not available right now. Invites you send wait here and go out once this Mac reaches the project. Advanced Other ways in, sync, roles" | Ask to edit answered: ["Ask a project owner for edit access."] |

## Per-step screenshots

### Open the project

**Plain browser (local studio)** — PASS

- table shell browser: 14 chrome testids present, 0 stray
- status word: "Local project"

![browser open-project](shots/browser-01-open-project-menu.png)
![browser open-project](shots/browser-01-open-project.png)

**Cloud tab (local cell, owner)** — PASS

- table shell cloud-owner: 14 chrome testids present, 0 stray
- status word: "Saved"

![owner open-project](shots/owner-01-open-project-menu.png)
![owner open-project](shots/owner-01-open-project.png)

**Cloud tab (viewer — Can comment)** — PASS

- table shell cloud-viewer: 14 chrome testids present, 0 stray
- status word: "Can comment"

![viewer open-project](shots/viewer-01-open-project-menu.png)
![viewer open-project](shots/viewer-01-open-project.png)

### Open a canvas

**Plain browser (local studio)** — PASS

- rendered in localhost:62273

![browser open-canvas](shots/browser-02-open-canvas.png)

**Cloud tab (local cell, owner)** — PASS

- rendered in canvas.cell.localhost:4799

![owner open-canvas](shots/owner-02-open-canvas.png)

**Cloud tab (viewer — Can comment)** — PASS

- rendered in canvas.cell.localhost:4799

![viewer open-canvas](shots/viewer-02-open-canvas.png)

### Select an element and inspect it

**Plain browser (local studio)** — PASS

- inspector: "Card Frame esc Frame Frame Uses smoke Position X · Y X Y Rotation It sits where its frame’s layout puts it. Pl"
- 14 editable input(s) in the Inspector (table readOnly=false)

![browser select-inspect](shots/browser-03-select-inspect.png)

**Cloud tab (local cell, owner)** — PASS

- inspector: "Card Frame esc Frame Frame Uses smoke Position X · Y X Y Rotation It sits where its frame’s layout puts it. Pl"
- 14 editable input(s) in the Inspector (table readOnly=false)

![owner select-inspect](shots/owner-03-select-inspect.png)

**Cloud tab (viewer — Can comment)** — PASS

- inspector: "Card Frame Cross-shell card esc Cross-shell card Text Uses smoke Type Style Aa No style Font Inherited Size · "
- 0 editable input(s) in the Inspector (table readOnly=true)

![viewer select-inspect](shots/viewer-03-select-inspect.png)

### Leave a comment

**Plain browser (local studio)** — PASS

- the Comments panel holds the comment: true (1 comment(s) listed — a cell shows every shell's)
- share-cluster-comments button drawn: true

![browser comment](shots/browser-04-comment-composer.png)
![browser comment](shots/browser-04-comment.png)

**Cloud tab (local cell, owner)** — PASS

- the Comments panel holds the comment: true (1 comment(s) listed — a cell shows every shell's)
- share-cluster-comments button drawn: true

![owner comment](shots/owner-04-comment-composer.png)
![owner comment](shots/owner-04-comment.png)

**Cloud tab (viewer — Can comment)** — PASS

- the Comments panel holds the comment: true (1 comment(s) listed — a cell shows every shell's)
- share-cluster-comments button drawn: true

![viewer comment](shots/viewer-04-comment-composer.png)
![viewer comment](shots/viewer-04-comment.png)

### Export a PNG

**Plain browser (local studio)** — PASS

- sheet: "Export “Card”" · scope selection
- server job done: "board — Card@1x.png PNG · On this Mac · just now Ready"
- downloaded board Card@1x.png — PNG signature ok

![browser export-png](shots/browser-05-export-png-sheet.png)
![browser export-png](shots/browser-05-export-png-job.png)
![browser export-png](shots/browser-05-export-png.png)

**Cloud tab (local cell, owner)** — PASS

- sheet: "Export “Card”" · scope selection
- browser lane: "Saved card.png to your downloads."
- downloaded card.png — PNG signature ok

![owner export-png](shots/owner-05-export-png-sheet.png)
![owner export-png](shots/owner-05-export-png-saved.png)
![owner export-png](shots/owner-05-export-png.png)

**Cloud tab (viewer — Can comment)** — PASS

- sheet: "Export “Cross-shell card One canvas, three shel…”" · scope selection
- browser lane: "Capturing…"
- downloaded card.png — PNG signature ok

![viewer export-png](shots/viewer-05-export-png-sheet.png)
![viewer export-png](shots/viewer-05-export-png-saved.png)
![viewer export-png](shots/viewer-05-export-png.png)

### Share sheet

**Plain browser (local studio)** — PASS

- share sheet (local project: no invite): "Share board Local project — kept on this Mac. Invite people once it is in the cloud. Advanced Links, link rules, sync"

![browser share](shots/browser-06-share.png)

**Cloud tab (local cell, owner)** — PASS · GAP

- share sheet (degraded): "Share board Sharing is not available right now. Invites you send wait here and go out once this Mac reaches the project. Advanced Other ways in, sync, roles"

![owner share](shots/owner-06-share.png)

**Cloud tab (viewer — Can comment)** — PASS · GAP

- Ask to edit answered: ["Ask a project owner for edit access."]

![viewer share](shots/viewer-06-share-asked.png)
![viewer share](shots/viewer-06-share.png)

### P8 re-run: cloud Share (2026-10-26)

`scripts/v2-verify/p84-cloud-share.sh` on the remote lane (the rig's two cloud shells, LOCAL cell, headless Chromium),
rev `8e0298bd6` on `p8-cloudshare`. The owner step now also sends one invitation from the tab and reads it back.

**Cloud tab (local cell, owner)** — PASS

- share sheet (invite + people): "Share board local-cell-smoke · syncs to the studio’s own hub Can edit Invite 1 person Y you you@local.test Owner Advanced …"
- invited from the tab — people list: "1 person · 1 invited Y you you@local.test Owner I invitee@local.test Invited just now · expires in 7 days Resend Can edit"

![owner share, invited](shots/p8cs-owner-06-share-invited.png)

**Cloud tab (viewer — Can comment)** — PASS

- Ask to edit answered: ["Asked. The owner will see your request."] (sent: the hub's `/api/access/requests` took it, 201)

![viewer asked](shots/p8cs-viewer-06-share-asked.png)

Not share, seen in the same run: the viewer's `select-inspect` step counted 15 editable inputs on a read-only Inspector,
and the owner's once found no selection (passed on the run before). The rig serves the COMMITTED
`dist/client.bundle.js` (`MAUDE_NO_AUTOBUILD=1`), which predates the frame fieldset fix above (`f336701dd`; dist is not
committed in phase 8) — re-check after the next release build before reading it as a regression. The "Asked." toast
carries the warning glyph although the request was sent.

## Page errors

**browser**
- `console: Unrecognized Content-Security-Policy directive 'webrtc'.`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 409 (Conflict)`
**owner**
- `console: failed to load comments TypeError: Failed to fetch
    at a (http://studio.cell.localhost:4799/_client/client.bundle.js?v=3e8a7a-1a176194722:55:5653)
    at http://studio.cell.localhost:4799/_client/client.bundle.js?v=3e8a7a-1a176194722:5786:43022
    at http://studio.cell.localhost:4799/_client/cli`
- `console: failed to load tree TypeError: Failed to fetch
    at a (http://studio.cell.localhost:4799/_client/client.bundle.js?v=3e8a7a-1a176194722:55:5653)
    at read (http://studio.cell.localhost:4799/_client/client.bundle.js?v=3e8a7a-1a176194722:5786:4703)
    at h (http://studio.cell.localhost:4799/_clien`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Unrecognized Content-Security-Policy directive 'webrtc'.`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
**viewer**
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Unrecognized Content-Security-Policy directive 'webrtc'.`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`

<!-- AUTHORED -->

## Defects found and fixed (each fail-first: red without the change, green with it)

1. **A Can-comment session could type into the Inspector.** On the cloud viewer, selecting the heading and typing a new
   text size changed the heading on the viewer's own canvas (an optimistic preview) while the server refused the write
   (`POST /_api/edit-css` 403, file unchanged) — the viewer saw a design that is not the design. `ctx.editable` was
   `!!el.id` and never looked at the role. Fix: `client/v2/inspector/frame.jsx` reads `advancedAccess(cfg).readOnly`,
   the same rule the Advanced fold already used, and disables the frame's fieldset. Test `test/p8-scen-viewer-inspector.test.tsx`
   (editor open · viewer, observer and `cfg.readOnly` closed; 3 red without the change).
2. **Ask to edit answered "not found".** In a cloud tab the project server's default-closed refusal of `/_api/share/requests`
   (`404 {"error":"not found"}`) was shown as the toast. Fix: `client/v2/access/access-client.js` treats a 404/405 as
   "not linked" ("Ask a project owner for edit access."). Test in `test/v2-access.test.tsx` (red without the change).
   Screenshot: `shots/viewer-06-share-asked.png` shows the fixed words.
3. **The shell-parity table promised a button the shell does not draw.** `shell-parity.json` listed `share-cluster-comments`
   as always on screen; P8 C3 (10 · S1) made the host draw it only once the canvas has a comment. The cross-shell run
   failed its first step on exactly that. Fix: the table moves it to `when`. Test in `test/v2-shell-parity.test.tsx` renders the
   cluster with `commentsShown={false}` and holds every listed testid to the screen (red without the change).

## What surprised us

- **Export has two lanes and the person sees both.** A local project runs a server job (the sheet closes, the Exports
  island lists "board — Card@1x.png · On this Mac · Ready"); a cloud tab with no render service captures in the page and
  the sheet stays open saying it saved a download. Both produced a valid PNG (signature checked, `shots/*-export.png`).
  The sheet's own lane note says why; it is intended, but it is the biggest visible divergence between shells.
- **Selection depth differs by mode, not by shell.** An editor's click selects the Frame (the select ladder), the viewer's
  click in Viewing selects the text itself (the inspect tool). S3.11 by design; the Inspector header follows it.
- **A cloud tab polls eleven routes the cell refuses on purpose** — `ai/runs`, `project/undo-stack`, `votes`, `outbox`,
  `pins`, `index`, `sync/conflicts`, `sync/trash`, `asset-state`, `diagnostics/disk`, `thumbs/want` (each a `REFUSED` row in
  `apps/hub/src/studio-manifest.mjs`). The user sees nothing, but every cloud tab boots with a screenful of 404s in the console.
- The comment a shell leaves is visible to the others (the viewer's Comments panel listed the owner's note and its own).
- The project server remembers the open tab, selection and panel folds between visits, so a rig must start from a fresh
  project every run (`p84-up.mjs` recreates it).
- Seed artefact, not a product fault: the local cell's seeded design system has no `colors_and_type.css`, so the canvas
  asks for it and gets a 403 on every shell.

## Recommended follow-ups

- **Done (P8 cloud-share, option (a), lead decision `maude/v2-8.4-lead-cloud-share-via-cell-fixed-map`)** — was:
  **Decision needed (hand-back to the lead): the cloud tab's Share sheet and Ask to edit have no door on a local cell.**
  The sheet and `askToEditRequest` call `/_api/share/*`; the cell proxy refuses that family (decision S9.21, "REFUSED in
  a cell") and says its browser asks the hub's `/api/access/*` — but the client never does, and `/api/access/*` takes a
  bearer, not the `maude_studio` cookie (401 "Sign in…"). So an owner's cloud tab shows "Sharing is not available right
  now … once this Mac reaches the project" (desktop wording in a tab) and a viewer's Ask to edit cannot send. Whether the
  real fleet differs cannot be checked here (a local cell has no control plane). Options: (a) the cell proxy maps
  `/_api/share/*` to `/api/access/*` with the session's identity; (b) the client switches to a cookie-accepting
  `/api/access/*` when `cfg.cloud` is set. Not picked here.
- The cloud tab should read `/_config` (cloud tab) and skip the eleven refused polls, or the manifest should answer them
  with an empty 200 where the answer is "nothing here" (undo-stack, conflicts, trash, outbox).
- The shell-parity table has no column for `observer` (Can view); the rig mints one (`sessions.observer`) but no scenario
  runs it. A `cloud-observer` shell would pin "no comment, no export" the way `cloud-viewer` pins Ask to edit.
- The Share copy for a cloud tab says "this Mac" (`share-model` words for an unlinked desktop) — wording for a tab.

## How to re-run

```
node scripts/v2-verify/p84-up.mjs <run-dir>                       # rig: local cell + plain studio, scenario canvas
node scripts/v2-verify/p84-scenarios.mjs <run-dir>/rig.json <out> [browser|owner|viewer]   # ~15 min on a busy Mac
node scripts/v2-verify/p84-report.mjs <out>                       # this file's mechanical half
```

Needs Node 24 on PATH (the hub's better-sqlite3 ABI), `bun`, Playwright chromium. Kill the rig (SIGTERM) when done.
