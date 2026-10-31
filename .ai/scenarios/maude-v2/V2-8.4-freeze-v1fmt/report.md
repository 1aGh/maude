# V2-8.4 — cross-shell scenarios

Web-desktop lane of the flow `scenario-runner` approach, run through `scripts/v2-verify/p84-up.mjs` (rig) and
`scripts/v2-verify/p84-scenarios.mjs` (driver, headless Chromium 1600×1000). Three shells, the same six steps, one
canvas (`ui/board.tsx`, a real `DesignCanvas` with one artboard). The cloud tab is a LOCAL cell (`scripts/dev/local-cell.mjs`:
hub in workspace mode + its studio child, served at `studio.cell.localhost`); the viewer is a `viewer`-role session
minted into that cell's own token store, the way the studio door mints one. Nothing production, no real hub / render /
Stripe / Cloudflare; throwaway HOME, stub `claude`.

## TL;DR

**4 failing step(s): owner/open-project, owner/select-inspect, owner/comment, viewer/comment** · 3 shells × 6 steps.

| Step | Plain browser (local studio) | Cloud tab (local cell, owner) | Cloud tab (viewer — Can comment) |
| --- | --- | --- | --- |
| Open the project | PASS | FAIL | PASS |
| Open a canvas | PASS | PASS | PASS |
| Select an element and inspect it | PASS | FAIL | PASS |
| Leave a comment | PASS | FAIL | FAIL |
| Export a PNG | PASS | PASS | PASS |
| Share sheet | PASS | PASS | PASS |

**Known gaps** (the step did what a person can see it do; the stand-in cannot reach the rest):

- none

## Parity

What each shell showed at each step (from the live page; the open-project row is checked against
`apps/studio/client/v2/shell/shell-parity.json`, the table the shell is pinned to).

| Step | Plain browser (local studio) | Cloud tab (local cell, owner) | Cloud tab (viewer — Can comment) |
| --- | --- | --- | --- |
| Open the project | table shell browser: 14 chrome testids present, 0 stray · status word: "Local project" | chrome the parity table lists is missing: mode-switch:palette-mode-edit · table shell cloud-owner: 13 chrome testids present, 0 stray | table shell cloud-viewer: 14 chrome testids present, 0 stray · status word: "Can comment" |
| Open a canvas | rendered in localhost:55014 | rendered in canvas.cell.localhost:4888 | rendered in canvas.cell.localhost:4888 |
| Select an element and inspect it | inspector: "Card Frame esc Frame Frame Uses smoke Position X · Y X Y Rotation It sits where its frame’s layout puts it. Pl" · 14 editable input(s) in the Inspector (table readOnly=false) | an editor sees no editable input in the Inspector · inspector: "Card Frame Cross-shell card esc Cross-shell card Text Uses smoke Type Style Aa No style Font Inherited Size · " · 0 editable input(s) in the Inspector (table readOnly=false) | inspector: "Card Frame Cross-shell card esc Cross-shell card Text Uses smoke Type Style Aa No style Font Inherited Size · " · 0 editable input(s) in the Inspector (table readOnly=true) |
| Leave a comment | the Comments panel holds the comment: true (1 comment(s) listed — a cell shows every shell's) · share-cluster-comments button drawn: true | locator.click: Timeout 30000ms exceeded. Call log:   - waiting for locator('.cm-composer textarea, .cm-composer [contenteditable="true"], .cm-composer input').first()     - locator resolved to <textarea rows="1" disabled aria-label="Comment body" class="cm-com | locator.click: Timeout 30000ms exceeded. Call log:   - waiting for locator('.cm-composer textarea, .cm-composer [contenteditable="true"], .cm-composer input').first()     - locator resolved to <textarea rows="1" disabled aria-label="Comment body" class="cm-com |
| Export a PNG | sheet: "Export “Card”" · scope selection · server job done: "board — Card@1x.png PNG · On this Mac · just now Ready" · downloaded board Card@1x.png — PNG signature ok | sheet: "Export “Cross-shell card One canvas, three shel…”" · scope selection · browser lane: "Capturing…" · downloaded card.png — PNG signature ok | sheet: "Export “Cross-shell card One canvas, three shel…”" · scope selection · browser lane: "Capturing…" · downloaded card.png — PNG signature ok |
| Share sheet | share sheet (local project: no invite): "Share board Local project — kept on this Mac. Invite people once it is in the cloud. Advanced Links, link rules, sync" | share sheet (invite + people): "Share board local-cell-smoke · syncs to the studio’s own hub Can edit Invite 1 person Y you you@local.test Owner Advanced Other ways in, sync, roles" · invited from the tab — people list: "1 person · 1 invited Y you you@local.te | Ask to edit answered: ["Asked. The owner will see your request."] |

## Per-step screenshots

### Open the project

**Plain browser (local studio)** — PASS

- table shell browser: 14 chrome testids present, 0 stray
- status word: "Local project"

![browser open-project](shots/browser-01-open-project-menu.png)
![browser open-project](shots/browser-01-open-project.png)

**Cloud tab (local cell, owner)** — FAIL: chrome the parity table lists is missing: mode-switch:palette-mode-edit

- table shell cloud-owner: 13 chrome testids present, 0 stray

![owner open-project](shots/owner-01-open-project-menu.png)
![owner open-project](shots/owner-01-open-project.png)

**Cloud tab (viewer — Can comment)** — PASS

- table shell cloud-viewer: 14 chrome testids present, 0 stray
- status word: "Can comment"

![viewer open-project](shots/viewer-01-open-project-menu.png)
![viewer open-project](shots/viewer-01-open-project.png)

### Open a canvas

**Plain browser (local studio)** — PASS

- rendered in localhost:55014

![browser open-canvas](shots/browser-02-open-canvas.png)

**Cloud tab (local cell, owner)** — PASS

- rendered in canvas.cell.localhost:4888

![owner open-canvas](shots/owner-02-open-canvas.png)

**Cloud tab (viewer — Can comment)** — PASS

- rendered in canvas.cell.localhost:4888

![viewer open-canvas](shots/viewer-02-open-canvas.png)

### Select an element and inspect it

**Plain browser (local studio)** — PASS

- inspector: "Card Frame esc Frame Frame Uses smoke Position X · Y X Y Rotation It sits where its frame’s layout puts it. Pl"
- 14 editable input(s) in the Inspector (table readOnly=false)

![browser select-inspect](shots/browser-03-select-inspect.png)

**Cloud tab (local cell, owner)** — FAIL: an editor sees no editable input in the Inspector

- inspector: "Card Frame Cross-shell card esc Cross-shell card Text Uses smoke Type Style Aa No style Font Inherited Size · "
- 0 editable input(s) in the Inspector (table readOnly=false)

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

**Cloud tab (local cell, owner)** — FAIL: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.cm-composer textarea, .cm-composer [contenteditable="true"], .cm-composer input').first()
    - locator resolved to <textarea rows="1" disabled aria-label="Comment body" class="cm-composer__textarea" placeholder="Add a comment — @ mentions someone" title="Comments are paused while this project is view only."></textarea>
 


![owner comment](shots/owner-04-comment.png)

**Cloud tab (viewer — Can comment)** — FAIL: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.cm-composer textarea, .cm-composer [contenteditable="true"], .cm-composer input').first()
    - locator resolved to <textarea rows="1" disabled aria-label="Comment body" class="cm-composer__textarea" placeholder="Add a comment — @ mentions someone" title="Comments are paused while this project is view only."></textarea>
 


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

- sheet: "Export “Cross-shell card One canvas, three shel…”" · scope selection
- browser lane: "Capturing…"
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

**Cloud tab (local cell, owner)** — PASS

- share sheet (invite + people): "Share board local-cell-smoke · syncs to the studio’s own hub Can edit Invite 1 person Y you you@local.test Owner Advanced Other ways in, sync, roles"
- invited from the tab — people list: "1 person · 1 invited Y you you@local.test Owner I invitee@local.test Invited just now · expires in 7 days Resend Can edit"

![owner share](shots/owner-06-share-invited.png)
![owner share](shots/owner-06-share.png)

**Cloud tab (viewer — Can comment)** — PASS

- Ask to edit answered: ["Asked. The owner will see your request."]

![viewer share](shots/viewer-06-share-asked.png)
![viewer share](shots/viewer-06-share.png)

## Page errors

**browser**
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
    at o (http://studio.cell.localhost:4888/_client/client.bundle.js?v=3f677b-1a192bb08d3:1:24987)
    at http://studio.cell.localhost:4888/_client/client.bundle.js?v=3f677b-1a192bb08d3:5789:13038
    at http://studio.cell.localhost:4888/_client/cli`
- `console: failed to load tree TypeError: Failed to fetch
    at o (http://studio.cell.localhost:4888/_client/client.bundle.js?v=3f677b-1a192bb08d3:1:24987)
    at read (http://studio.cell.localhost:4888/_client/client.bundle.js?v=3f677b-1a192bb08d3:5787:4703)
    at h (http://studio.cell.localhost:4888/_clien`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
**viewer**
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
- `console: Failed to load resource: the server responded with a status of 403 (Forbidden)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`
- `console: Failed to load resource: the server responded with a status of 404 (Not Found)`

<!-- AUTHORED -->

## What surprised us

_TBD_

## Recommended follow-ups

_TBD_
