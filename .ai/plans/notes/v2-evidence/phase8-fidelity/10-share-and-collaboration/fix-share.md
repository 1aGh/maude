# 10 Share and Collaboration — stage C fix (C7-share-collab), PARTIAL

Branch `p8-c-share`. The run was cut short by the lead (weekly budget): stage D re-shoots were NOT done, so no artboard
is marked matching. Everything below is code + unit tests; none of it has been looked at in a shot yet.

## Done (code, tests green: p8-c7-share-collab, share-sheet, share-advanced, presence-faces, share-cluster, v2-save-status, v2-sync-states, v2-access*)

Share sheet (co-share-sheet · co-share-roles · co-share-advanced · co-local-cloud)
- team row "Everyone in <project> · N people · change it in Whole project" and "+ N in <project>" (share-model `teamRow` / `restLine`; the sheet asks the project's own list too when sharing one canvas).
- tone-filled faces with ONE letter (`person.jsx`, `.k-av` in share.css); You is yellow with no e-mail sub-line; invitation line "Invited 2 days ago · expires in 5 days" (needs `invitedAt` from the hub, see Patch requests).
- role menu no longer clipped: `position: fixed`, placed from the role button, flips above when short of room (`role-menu.jsx`); check glyph is a drawn icon; focus row has a ring.
- link row: link icon tile, sub-line is the link's role ("Can view"); Advanced hint "Links, link rules, sync"; Resend in the accent (rule moved to `@layer components`, where `.btn--ghost` lives).
- header: drawn × (kept, stable testid `share-close`), sheet top 64 px, Share button gets the 3 px open ring (`:has`), self-hosted sub-line.
- Advanced rows lifted from the board: key left / mono value right + copy glyph, 140x28 selects (`select` class), GitHub row, matrix with drawn ticks and the missing "Can view is look only" sentence, "Open in the Mac app".
- local offer: no "Share X" heading, no Advanced fold, one heading (the question, `aria-labelledby`), body type-sm fg-1, Cancel is a plain `.btn`.
- Remove dialog copy per board, no gendered pronoun.

Presence / cluster (co-presence · co-browser-view · co-sync-offline)
- faces: tone FILL + ink + one letter (no "YO"/"MD"), AI face is the spark with no letter, "+N" is a grey face named "N more here"; face menu: arrow-key roving, focus in on open, esc returns focus to the face, glyph column.
- access word ("Can view") fg-1 medium; offline tooltip "Invites send when this Mac is online." under Share (hover/focus).

Sync (co-sync-offline · co-sync-back · co-conflict)
- conflict: real yellow stickies (DS `.sticky`), author face + "Yours · when · this Mac" / "Jonas · when · their Mac", Keep both with the duplicate glyph, Version history card beside (Restore = the same pick, foot "Both stay here whatever you keep. ⌥⌘H"); "2 versions" mark = two tone faces in the warn ring; removal words ("You removed it", never "deleted").
- "6 Oct, 14:05" (comma) everywhere `whenWords` is used; offline panel foot is fg-2 (no warn tone); the duplicate "Back online. Everything is synced." callout is gone (one back-online line).
- back-online toast now passes `placement: 'top'`, `icon: 'sync'` (see Patch requests).

Access (co-access-ends · co-trashed · co-ask-edit)
- access card: padding space-5, 36 px round lock chip, type-md title, type-sm body, home glyph on Back to Home, sits low; `aria-modal`, described, focus on Back to Home, Tab trapped, no esc. Link-off card the same.
- trashed banner at top 16 px with a 28 px round chip; Preview's own line steps aside while it is up; ghost row name stays fg-2 (contrast).

## Still open (not started or blocked) — per artboard
| id | state |
|---|---|
| co-follow · co-bring · co-spotlight · co-twelve | NOT BUILT. The capture stub: peers reach the shell as `dgn:'peers'` from the canvas, which reads Yjs awareness over `/_ws/collab/:slug` on the local studio. Plan: a Node fixture (`apps/studio/test/fixtures/presence-peers.mjs`) that joins that room as N Yjs clients with awareness `{name, artboard, cursor, viewport, summon}`; twelve = 11 of them. Spotlight pill "Everyone here is following you · 3 people" + Stop and the "Following Tereza" pill have no string in the client (product work in `presence/canvas-presence.tsx`). |
| co-presence | a peer's AI row in the face menu and the "AI is making it greener" tag need a new awareness field (peer AI) — product + hub sanitiser work. |
| co-share-roles | "Make owner" row still hidden (decision v2-lead-make-owner-hidden: no transfer route). "Whole project — Lukáš sees all 93" third caption has no string. |
| co-comment-thread | Comments panel: close button (`onClose` never passed in `use-palette-and-panels.jsx:877`), tone avatar rows, filter count spacing, "A4 · plakát" place line, `Reply…` placeholder — NOT done. Board 10 draws the panel on the LEFT with 3 filters; CONTRACT §6 says RIGHT with 4 (Open · Mine · Resolved · All): the BOARD must be fixed (board-fixed, not done). |
| co-comment-video | timeline comment markers + "2 comments on this video", glyphs in the thread header/time chip — NOT done. |
| co-comment-print · co-mention-notify | print guides default off (not a product change); mention e-mail template does not exist in `apps/hub`; OS banner is native-only — unreachable. |
| co-sync-back | "Tereza changed this · 09:15" tag: no data source in the product (needs per-artboard remote-change tracking while offline) — NOT done. Per-row "not sent / sending" tags need per-canvas pending data. |
| co-ask-edit | owner request block restyle (`.co-req`: accent-muted, face, "Petra can view it now" — `WORDS.canViewNow` still the bare phrase) and the dark tip metrics — NOT done; trigger for the tip in the lane: a >8 px drag on a `.dc-artboard-body` of a `?ro=1` canvas. |
| co-browser-view / co-trashed / co-access-ends | zoom pill overlapping the left panel foot: belongs to C9 (panel stops above the bottom row). Comments icon always drawn in the cluster (kit draws it only with comments): needs a lead decision (menu / ⌘K are its only other doors). |
| co-share-advanced | "247 assets" in Last synced: `/_sync-status` has no asset count. Link values show `.tsx` paths (link builder, data). |
| all | `Moved to the cloud — 3 canvases…` count: needs a canvas count prop from `app.jsx`. Header × kept (stable testid, two e2e scenarios). |

## Patch requests
- `apps/hub/src/routes-v2/access.mjs` `peopleFor`: add `invitedAt: inv.createdAt` to invitation rows (owner-only block).
- `apps/studio/notifications.tsx` (C1): accept `placement: 'top'` and `icon` on `Notice`; `sync-states/back-online.jsx` already passes both.
- Shared-file touches in this branch (separate from C7 files): `client/v2/shell/share-cluster.{jsx,css}`, `client/v2/shell/save-status.js`, `client/v2/shell/callouts-model.js`, `client/v2/canvases/canvases.css` (one rule). No `app.jsx`, no dist.

## Round 2 (p8-c2-chatshare)
See `../03-ai-chat/fix-chatshare.md`: hub `invitedAt`, Notice `placement`/`icon` (pill toast), Comments panel close + tone faces + Reply placeholder are DONE (patch requests implemented). Open: presence-peers stub, video comment markers, "Tereza changed this", conflict-on-canvas, board-side fixes for the Comments panel (4 filters, right).
