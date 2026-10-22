# copy-critic — 10 Share and Collaboration (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/10 Share and Collaboration.tsx` · voice: CONTRACT §3 words + §4 voice (no we/I, what happened · what is safe · one verb, relative times, "You" for the signed-in person) · impl frames: `.claude/worktrees/agent-a0a73ec7448623bcc/.scr/impl/10-share-and-collaboration/` (dark read frame by frame, light sampled: share-sheet, sync-offline, trashed — copy identical across themes, so every finding below holds for dark AND light)_

Lens: every visible string. Fixture content (white demo canvases, "Print"/"Smoke"/"Video" canvas names, "A · přední (FLAG)", Czech sticky bodies, "Michal" as fixture person) is not a finding. Where the board and CONTRACT disagree, CONTRACT wins and the row is marked **board-side**.

## co-share-sheet · dark + light

| difference | spec (board) | impl | owner | sev |
|---|---|---|---|---|
| Link row sub-line is a sentence, not the link's role | `Anyone in Alligators brand with the link` · **`Can view`** | `…with the link` · **`Opens it for people who already have access`** | `client/v2/share/share-model.js:260` (`linkRowWords`, team branch) | blocker |
| Advanced fold count words | `Links, link rules, sync` | `Link rules, other ways in, where it syncs` | `client/v2/share/share-model.js:303` | blocker |
| People head second half missing | `3 people · 1 invited` + `+ 9 in Alligators brand` | `3 people · 1 invited` only | `client/v2/share/share-model.js:205-209` (`countLine`) | blocker |
| Team row missing | `Everyone in Alligators brand` · `9 people · change it in Whole project` · `Can edit` | no row | `client/v2/share/people-list.jsx:72-148` (no team row source) | blocker |
| Invitation sub-line drops when it was sent | `Invited 2 days ago · expires in 5 days` | `Invited · expires in 5 days` | `client/v2/share/share-model.js:186` | warning |
| Owner row is not "You" and carries an e-mail | `You` (no sub-line) · Owner | `Michal` / `michal@alligators.cz` · Owner | `share-model.js:178-187` (`isYou` needs `youEmail` to match; the faked `/me` didn't) — and even as "You" the row keeps `p.email` as sub | warning (fixture-tinged) |
| Face initials "YO" | You's face shows the person's initial (kit `you.ini = "M"`) | `YO` (initials of the word "you") | `client/v2/shell/save-status.js:141` (`initialsOf(you \|\| 'you')`) | blocker (every frame) |
| Stray toast not on this board | — | `Back online. Everything is synced.` | `client/v2/shell/callouts-model.js:127` — a SECOND back-online line beside `sync-states-model.js:59` | warning (harness timing, but the duplicate line is real) |

## co-share-roles · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| "Make owner" row absent | `Make owner` · `Owners also invite people and clear out the trash` | not drawn | `client/v2/share/share-model.js:142` (`makeOwner: false`) | blocker |
| "Remove from …" row not visible | `Remove from Combine-kampan` (danger) | clipped under the sheet's bottom edge | `client/v2/share/role-menu.jsx:246-256` + sheet overflow (`share.css`) | blocker |
| Role words + lines | Can edit / Can comment / Can view + lines | match | `share-model.js:17-20` | — ok |
| Columns "This canvas — Petra sees one canvas" / "Whole project — Lukáš sees all 93" | `Shared with you · Can view`, `Only Combine-kampan was shared with you.`, `New canvases join this list for him too.` | not in frame; first two exist (`client/v2/access/access-client.js:49-50`), the third has **no string anywhere** | — | warning (unreached) / blocker for the missing third line |

## co-browser-view · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Project pill name missing | `Alligators brand / Combine-kampan` | mark only (folded) | Preview folds the pill — 04 Modes rule (`04 Modes.tsx:1232-1276`) | warning **board-side**: board 10 draws the unfolded pill in Preview; impl follows 04 |
| Preview bar the board doesn't draw | — | `Previewing Print · esc for Viewing` | `client/v2/preview/preview-bar.jsx:17-19` | warning **board-side** (04 md-edge-viewer draws it) |
| Access word + action + browser door | `Can view` · `Ask to edit` · `Open in the Mac app` | match | `access-client.js`, `where-matrix.js:124` | — ok |

## co-presence · dark + light (partial — needs a hub + peers)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Status word | `Saved` (cloud, 3 faces + `+4`) | `Local project` (lane is local) | state, not copy | not-a-finding |
| Face menu lacks the AI row | `Tereza's AI` · `Story 9:16 · view only` | menu has header, Follow, Go to, Bring everyone here only | `client/v2/presence/faces.jsx:98-150` | blocker (unreached, but code has no row) |
| AI face letter | AI wears the spark, never a letter | agent face is the letter `C` (Claude) | `client/v2/shell/save-status.js:143`, `faces.jsx:84` | warning (CONTRACT §3: not "Claude") |
| Overflow face name | `4 more here` | `"+N more — see everyone"` aria; board name has no string | `faces.jsx:276` | warning |

## co-comment-thread · dark + light (partial)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Filter segment has All | `Open 4 · Mine 1 · Resolved 6` | `Open 1 · Mine 0 · Resolved 0 · All 1` | CONTRACT §6 lists `Open · Mine · Resolved · All` | not-a-finding — **board-side** (board omits All) |
| Row's place line is the canvas, not the artboard | `A4 · plakát` (artboard) over the body | `Smoke` (canvas name; already the group head) | comments panel row (`client/v2/comments/`) | warning |
| Author face "?" | author's initial | `?` | fixture (no author name in the lane) | warning (fixture-tinged) |
| Mention picker row | `Tereza` · `Can edit` | did not open on `@Te` | — | warning (unreached) |
| Thread chrome | `Resolve`, `2 h ago`, `Reply…` placeholder | thread not reachable (no other authors); `Reply…` exists nowhere in client | `comments-overlay.tsx:1492` (only the new-comment placeholder) | blocker (missing reply placeholder string) |

## co-comment-video · dark + light (partial)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Time chip | `at 0:12` | `at 0:00` (same pattern) | `apps/studio/comments/where.ts` | — ok |
| Timeline count | `2 comments on this video` | no string anywhere in client | — | blocker (missing state) |
| New-comment placeholder | board draws only `Reply…` | `Add a comment — @ mentions someone` | `apps/studio/comments-overlay.tsx:1492` | warning (no board string for a new comment) |

## co-comment-print · dark + light (partial)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Where chip | `14 mm from the left · 2 mm above the trim` | `47 mm from the left · 70 mm from the top` | `apps/studio/comments/where.ts:92-105` names the nearer side — correct for this point | not-a-finding |
| Guides tag | `Bleed 3 mm · trim · safe margin 5 mm` | absent | print-guide overlay | warning |

## co-sync-offline · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Status word | `Offline — kept on this Mac` | match | `save-status.js:34` | — ok |
| Foot | `14 changes since yesterday 18:20 — kept on this Mac` | `14 changes since 17:02 — kept on this Mac` | `sync-states-model.js:37-46` — same pattern, the lane went offline today | — ok |
| Invite tooltip | `Invites send when this Mac is online.` | not shown (string exists at `share-sheet.jsx:248` as a sheet notice, not a tooltip on Share) | — | warning |
| Queued comment | `Queued — sends when this Mac is online.` under the pin | not in frame (string exists, `access-client.js:26`) | — | warning (unreached) |
| Row metas | `not sent` on unsent canvases | none | fixture rows not linked | warning |
| Older-date form | CONTRACT §4 `6 Oct, 14:05` | `whenWords` gives `6 Oct 14:05` (no comma) | `client/v2/sync-states/sync-states-model.js:26-27` | warning |

## co-sync-back · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Toast | `Back online. Your changes are going up; one sticky needs a look.` + `Show` | `Back online. Your changes are going up.` (no conflict faked here) | `sync-states-model.js:57-63` — conditional half is implemented | — ok |
| Foot | `Sending 14 changes · 9 sent` | `Sending 14 changes · 0 sent` | same pattern | — ok |
| Overnight-change tag | `Tereza changed this · 09:15` | no string anywhere in client | — | blocker (missing state) |
| Row metas | `sending` | none | fixture | warning |

## co-conflict · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Title / sub / buttons | `You and Jonas both changed this sticky while offline.` / `Both versions are here. Keep one, or keep both side by side.` / Keep yours · Keep Jonas's · Keep both | match | `sync-states-model.js:103-115` | — ok |
| Who lines drop the time and place | `Yours · yesterday 21:40 · this Mac` · `Jonas · today 7:55 · his Mac` | `Yours · this Mac` · `Jonas's` | `sync-states-model.js:107,109` | blocker |
| Note text promoted to UI | Note 14 says it; the UI's line is the VH card foot `Both stay here whatever you keep. ⌥⌘H` | `Whichever you keep, Version history shows the other, with Restore.` | `sync-states-model.js:116` | warning |
| Version history card | `Version history` · `this sticky` · rows with `Restore` | absent | — | blocker (missing state) |
| Deleted-side words (code) | CONTRACT §6/§7: ⌫ *removes*; never "deleted" | `You deleted it.` / `${who} was deleted.` | `sync-states-model.js:107,110` | warning |

## co-trashed · dark + light

Banner `Tereza moved Print to the trash · 2 min ago` / `You can keep looking. Your unsent changes stay with it.` / `Restore`, ghost row `In the trash · open here`, Trash row — all match the board's words (`access-client.js:44-48`, `trashed-banner.jsx:34`). **No copy difference.**

## co-local-cloud · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Offer card under an extra title | card opens straight on `Move "Portfolio 2026" to the cloud?` | `Share Smoke` heading above the question | `client/v2/share/share-sheet.jsx` header (always drawn) | warning |
| Advanced fold on a local offer | none | `Advanced · Link rules, other ways in, where it syncs` | `share-sheet.jsx:536` (`ShareAdvanced` always mounted) + `share-model.js:303` | blocker (link rules on a local project) |
| Step-3 toast | `Moved to the cloud — 3 canvases are going up now.` | `Moved to the cloud — your canvases are going up now.` | `client/v2/share/move-to-cloud.jsx:67,70` | warning (count dropped) |
| Question, body, Cancel / Move to cloud, `Only need a file? Menu › Export… ⇧⌘E` | — | match | `move-to-cloud.jsx:34-60` | — ok |

## co-ask-edit · dark + light (partial)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| View-only tip | `You can look at Combine-kampan, not change it.` / `Ask to edit, top right, sends a request to its owner.` | not triggered (drag message not faked); strings exist | `access-client.js:31-32` | warning (unreached) |
| Owner side | toast `Petra asks to edit Combine-kampan` · `Review`; block `2 min ago · she can view it now` · `Not now` / `Let Petra edit` | not shot; impl line is `can view it now` (no "she") | `access-client.js:33-36` | warning |
| `Can view` + `Ask to edit` | — | match | — | — ok |

## co-access-ends · dark + light (middle frame only)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Access card | `You no longer have access to Alligators brand.` / `Your last changes were saved first. If this is a surprise, ask someone on the team.` / `Back to Home` | match | `access-client.js:39-41` | — ok |
| Remove dialog body (left frame, code) | `He stops seeing its 93 canvases right away. Everything he made stays in the project.` | `Lukáš can no longer open Alligators brand. Their last changes are saved first.` | `client/v2/share/share-sheet.jsx:67` | blocker |
| Link-off card (right frame) | `This link was turned off.` / `Ask the person who shared Combine-kampan for a new one.` | strings match (`access-client.js:42-43`); frame not shot | — | — ok |
| Stray What's new toast | — | `What's new — A new look: …` | harness (not dismissed) | not-a-finding |

## co-share-advanced · dark + light (partial)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Fold count words | `Links, link rules, sync` | `Link rules, other ways in, where it syncs` | `share-model.js:303` | blocker (same as sheet) |
| Extra line under App link | — | `Opens the folder on this Mac only.` | `client/v2/share/share-advanced.jsx:296` | warning |
| Link values are file paths | `maude://alligators/combine-kampan` · `localhost:4402/?c=Combine-kampan` | `maude://open/project?open=ui/Print.tsx` · `http://localhost:50919/?open=ui/Print.tsx` (`.tsx` + scheme shown) | link builder feeding `share-advanced.jsx:285-293` | warning |
| Copy affordance | copy icon, title `Copy` | text button `Copy` | `share-advanced.jsx:73` | warning |
| Browser door wording | `Open in the Mac app` (board-wide) | `Open in app` | `share-advanced.jsx:300` | warning |
| Matrix foot drops a sentence | `…never more. Can view is look only — downloads start at Can comment. The trash keeps…` | the middle sentence is missing | `share-advanced.jsx:197-200` | warning |
| Last synced | `6 Oct, 14:05 · 247 assets` | `whenWords` → `6 Oct 14:05`, no asset count | `share-advanced.jsx:318`, `sync-states-model.js:26-27` | warning |
| This link rows / Other ways in / Where it syncs / Roles on this hub / self-hosted line | — | words match (`share-advanced.jsx:128,170,239,325,332,354,359`) | — | — ok |

## Unreachable artboards (findings: the state doesn't exist yet)

- **co-follow**: needs a 2nd live peer on a hub. `Following Tereza` + esc pill — client has Follow/Stop following (`faces.jsx:59-60`); the pill string itself wasn't found.
- **co-bring / co-spotlight**: needs ≥2 peers. `Everyone here is following you · 3 people` + `Stop` has **no string** in client → product work: the spotlight pill.
- **co-mention-notify**: OS banner + e-mail. Toast `Jonas mentioned you on A4 · plakát` exists (`mention-model.js:115`); e-mail lives on the hub (`From cloud.maude.sh`, `Change which e-mails you get in Settings › General.`), not checked here.
- **co-twelve**: needs 12 peers. List head `12 on Combine-kampan` / `you + 11`, `idle · 4 min`, `in a browser · Can view`, `in Comments` all exist (`presence/model.ts:59-144`).

## Root causes that hit several artboards

1. **Share › Advanced hint words differ from the board** (`share-model.js:303`): co-share-sheet, co-share-advanced, co-local-cloud.
2. **Team link row sub-line replaced by an explanation** (`share-model.js:260`), and the team row + "+ 9 in …" count have no source: co-share-sheet, co-share-roles.
3. **Your face is "YO"** (`save-status.js:141`) and the AI face is "C" (`:143`): every frame with a cluster.
4. **Who/when dropped from secondary lines**: invite sub, conflict who-lines, move-to-cloud count, Last synced assets (`share-model.js:186`, `sync-states-model.js:107-109`, `move-to-cloud.jsx:67`).
5. **Missing strings for drawn states**: `Reply…`, `2 comments on this video`, `Tereza changed this · 09:15`, the conflict's Version history card, the spotlight pill, `New canvases join this list for him too.`
6. **Two back-online toasts** (`callouts-model.js:127` vs `sync-states-model.js:59`).
7. **Board-side drift from 04**: board 10 draws the unfolded pill and no Preview bar in Preview frames; impl follows 04. Fix the board, not the impl.

```json
{"canvas":"10 Share and Collaboration","critic":"copy-critic","blockers":17,"warnings":30,"verified_ids":["co-trashed-dark","co-trashed-light"]}
```
