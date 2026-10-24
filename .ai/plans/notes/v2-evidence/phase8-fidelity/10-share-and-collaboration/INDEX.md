# 10 Share and Collaboration — stage A evidence (G4)

20 artboards · 15 paired (dark + light = 30 pairs) · 5 not reachable. Spec = board rendered from a scratch copy of `.design` (capture origin, app theme flipped dark/light, 1:1 camera). Impl = release client, Playwright Chromium 1440×860 with a `window.__TAURI__` stub, the e2e fixture project renamed "Alligators brand". Full-size pairs: see `full-size-path.txt`; committed JPEGs: `<id>-<theme>.jpg` here. Spec-only frames of the unreachable boards: `spec-only/`.

How to read: left = spec (board crop), right = impl. **Content differs by design** (the board draws Alligators' 93-canvas project with people; the lane has one local project, the e2e fixture's white demo canvases). Differences below are chrome/layout/copy/state, not content. Dark was compared frame by frame; light was compared on a sample (share-sheet, trashed, deeplink-style frames) and the same chrome differences held. **Faked** means the state was produced by Playwright route interception of one API, not by a real hub; the app code path is the real one.

| id | theme | state | how reached | impl reachable? | first-glance differences |
|---|---|---|---|---|---|
| co-share-sheet | dark · light | Share, Invite first, people, link row | FAKED `/_api/share/{posture,me,people}` (cloud, roles-v2, links, 4 people, 1 invite), then Share | yes (faked hub) | Sheet is a plain solid panel without the 440 px "Share Combine-kampan" card look: title reads "Share Print" (canvas name ok); the This canvas / Whole project segment is a flat two-cell bar, spec has a pill segment. Email field is a bare input + native-looking `<select>` "Can edit" with an OS chevron (spec: tokened InSelect + blue Invite). Invite button is outlined, not filled blue. People rows are one-line tight (no avatars wearing tone colours: initials only, grey); role cell "Can edit ⌄" is plain text. Missing spec rows: "Everyone in Alligators brand · 9 people" team row and the "+ 9 in Alligators brand" count. Link row: spec "Anyone in … with the link · Can view [Copy link]" vs impl subline "Opens it for people who already have access". |
| co-share-roles | dark · light | Role menu (Owner / Can edit / Can comment / Can view, in words) | FAKED share API; click the 3rd person's role cell | partially: menu opens; scope switch "one canvas or the whole project" part of the board not drawn at that size | Menu is a small popup under the cell; spec is a large closeup with a line of explanation under every role word. Check mark / selected row styling differs. |
| co-browser-view | dark · light | Viewer in a plain browser tab (Can view, Ask to edit, "Open in the Mac app") | FAKED `/_config` (`readOnly`, `cloud.role=observer`), plain browser (no Tauri) | yes | No browser-window frame to compare (spec draws a browser chrome). Cluster shows "Can view" + "Ask to edit" correctly; no Tereza/Jonas face stack (no peers). Canvas boards are the white fixtures. Top-left pill: spec "Alligators brand / Combine-kampan", impl "Alligators brand / Print". |
| co-presence | dark · light | Faces, cursors, two AIs, Follow menu | lane has one local user | partially: cluster with one face + "Local project" word. Missing: other people's faces/cursors/name tags, "AI is making it greener" tag, Tereza's AI, the face menu ("Follow Tereza", "Bring everyone here") — needs a hub + 2nd peer. | Spec cluster: 3 faces + "+4" overflow, "Saved"; impl: single YO avatar ring, "Local project". Toolbar present in both. |
| co-follow | dark · light | Following Tereza (57 % follow view) | — | **no** — follow needs a second live peer on a hub; no route to fake the presence frames | see `spec-only/` |
| co-bring | dark · light | "Bring everyone here" moment | — | **no** — needs ≥2 peers | spec-only |
| co-spotlight | dark · light | Everyone's here (spotlight) | — | **no** — needs peers | spec-only |
| co-comment-thread | dark · light | Comment being written with a mention + Comments panel | real: Preview › C › click › type "…@Te", then the Comments panel | partially: composer + panel are real; mention picker did not open with "@Te" in the shot and the thread/Resolve state (Jonas + Tereza replies) is not reachable (no other authors) | Spec: composer popup under the pin with "Tereza · Can edit" suggestion; impl: pin + panel only, panel "Open 1 / Mine 0 / Resolved 0 / All 1" vs spec "Open 4 / Mine 1 / Resolved 6" (data). The panel docks at the right edge; spec docks at left of the canvas as a card. |
| co-mention-notify | dark · light | Mac banner + e-mail for a mention | — | **no** — OS notification / e-mail, not in a browser lane | spec-only |
| co-comment-video | dark · light | Comment on a video frame | Preview, C, click on the video canvas | yes, partially: the composer opens on the video clip with an "at 0:00" time chip (the contract's time anchor is there); fixture clip is a 320×180 placeholder | Spec: a 1080×1920 reel, an existing 2-comment thread (Tereza, Jonas, Resolve, Reply field), the pin on the frame and the timeline below with two comment pins + "2 comments on this video". Impl: only the new-comment composer, no timeline strip under the clip in this frame, no pin yet. |
| co-comment-print | dark · light | Comment on a print artboard | Preview, C, click on Print | yes, partially: pin on the artboard; spec shows guides + pin anchored to the print artboard | Impl A·přední artboard is blank white (fixture) with no print-guide overlay. |
| co-sync-offline | dark · light | A day offline: "Offline — kept on this Mac", panel foot "14 changes since …" | FAKED linked project (`/_sync-status`) + `context.setOffline(true)` + FAKED `/_api/outbox` pending=14 | yes (faked) | Cluster word matches ("Offline — kept on this Mac", warn tone). Foot says "14 changes since 16:41 — kept on this Mac" (spec: "since yesterday 18:20"). Spec has the invite tooltip "Invites send when this Mac is online." and a queued comment ("Queued — sends when this Mac is online.") and per-row "not sent" labels; impl: none of these. |
| co-sync-back | dark · light | Back online, "Sending 14 changes · 9 sent" | same, setOffline(false) | yes (faked) | Toast bottom-centre "Back online. Your changes are going up." (spec: top-centre banner with "one sticky needs a look · Show"). Foot "Sending 14 changes · 0 sent" ok; spec has per-row "sending" tags and "Tereza changed this" tag. |
| co-conflict | dark · light | Same sticky changed on two Macs: Keep yours / Keep Jonas's / Keep both | FAKED `GET /_api/sync/conflicts` + `maude:sync-conflicts-open` | yes | Card is a floating dark popover at top, copy matches the contract words ("You and Jonas both changed this sticky while offline."). Spec draws the two stickies side by side on the canvas with "or" between and buttons under each; impl shows plain text boxes "Datum je moc malé" / "Datum větší, 28 pt" in the card (no sticky look) and no Version-history card beside. Buttons small outlined (spec filled pills). |
| co-trashed | dark · light | Moved to the trash while open: banner + Restore, ghost row | FAKED `GET /_api/trash` lists the open canvas | yes (faked) | Banner and copy match ("Tereza moved Print to the trash · 2 min ago" / "You can keep looking…"); impl banner sits lower-centre overlapping the artboard label, with a text "Restore" blue button; ghost row "In the trash · open here" present in the panel but dim/tiny. Spec banner is higher. Impl cluster shows Preview glyph (mode lane in Viewing) fine. |
| co-local-cloud | dark · light | Local project: Share offers Move to cloud | real local project, desktop stub, click Share | yes | Same offer concept; impl dialog is narrower, no offer illustration and no 3-step "offer → sign in → Invite while it goes up" bullets that the spec shows. (Crop shows the Share sheet only.) |
| co-twelve | dark · light | Twelve people on one canvas (+9, cursors) | — | **no** — needs 12 peers | spec-only |
| co-ask-edit | dark · light | Can view, trying to change something: view-only tip, Ask to edit | FAKED `/_config` readOnly+observer | partially: "Can view" + "Ask to edit" in the cluster are real; the view-only drag tip (dark tooltip "You can look at …, not change it") not triggered (needs an in-canvas drag message); no owner-side "Ask to edit waits at the top of Share" card | Spec is a closeup of Petra's Mac with the dark tip; impl has no tip. Cluster word styling matches. |
| co-access-ends | dark · light | Access ended: dim + card with Back to Home; link-off card | FAKED 401 `{reason:"access-withdrawn"}` on the `/_health` refusal probe, plain browser | partially: the access card (middle frame of the board) reachable; the owner "Remove Lukáš?" confirm (left) and the link-off card (right) are separate frames not shot | Copy matches. Impl card is much smaller (≈210 px wide vs ≈340 px, smaller type, lock chip small) and sits over a dimmed canvas with the 3-line text left-aligned; spec card is large, 20 px radius, filled blue "Back to Home" with a home glyph (impl: small button, no glyph). The shot also caught the "What's new" toast bottom-right (not dismissed in this frame) — harness, not product. |
| co-share-advanced | dark · light | Share › Advanced: link rules, other ways in, where it syncs | FAKED share API; open the "Other ways" fold (`share-other-ways-toggle`) | yes (faked), partially: GitHub / app-link / where-it-syncs rows show; the role matrix column (cloud) and "This link" rules (who/role/expires) need owner + links caps; shown only in part | Impl fold is a plain list; spec is 3 columns (link rules · roles matrix · where it syncs). Typography denser in impl. |

## Notes for the critics
- All dark-theme frames compared; see the pair for each. The impl is always the real shell; only state sources were faked, as stated per row.
- Left-panel folded in most impl frames (to match the board's windows); the Canvases panel was open in sync frames because the foot lives there.
- Console: the `webrtc` CSP directive warning and refused WebSockets (403 from the capture origin, spec side) are expected and unrelated.

## After (stage D, 53ceb26c5)

Re-shot on the release client of `feat/maude-v2` @ `53ceb26c5` (stage C rounds 1 + 2 merged), same harness and fixture as stage A (Playwright Chromium 1440x860, `window.__TAURI__` stub, e2e fixture renamed "Alligators brand", the same faked share / sync / trash / config routes). The `*.jpg` pairs in this folder are the new ones. Spec side: **reused** — `10 Share and Collaboration.tsx` has not changed since the stage-A shot (last board commit 2026-10-21, stage A 2026-10-22), so the stage-A spec PNGs were copied in. Full-size pairs: `full-size-path.txt` (stage D line).

Harness-only changes (no product code): the "What's new" notice now has a "See all" button before its close, so the dismiss selector is `button.maude-notice-close`; `co-access-ends` impl crop moved (the card now sits lower, `900x620+270+240`); `co-ask-edit` uses a new frame (below).

| id | dark · light | note |
|---|---|---|
| co-share-sheet, co-share-roles, co-share-advanced | re-shot | same faked share API |
| co-browser-view, co-presence | re-shot | presence still one local face (no peers) |
| co-comment-thread, co-comment-video, co-comment-print | re-shot | real comment composer / panel |
| co-sync-offline, co-sync-back | re-shot | faked linked project + browser offline + outbox 14 |
| co-conflict, co-trashed, co-local-cloud | re-shot | faked conflicts / trash routes; real local Share |
| co-access-ends | re-shot (`s10c` variant: card over the canvas, whats-new dismissed) | faked 401 `access-withdrawn` |
| co-ask-edit | re-shot, **newly reachable state**: the view-only tip ("You can look at Print, not change it. Ask to edit, top right, sends a request to its owner.") appears on a >8 px drag on the artboard of the faked read-only canvas (frame `co-ask-edit-tip`); stage A shot only the cluster | owner-side request card is still not shot |
| co-follow, co-bring, co-spotlight, co-twelve | unreachable | not built: need N live peers (Yjs awareness over `/_ws/collab`), no fixture, and the Follow / spotlight pills have no client string (`fix-share.md`) |
| co-mention-notify | unreachable | OS banner / e-mail, no template, native only |

Spec-only JPEGs of the five unreachable ids are unchanged (`spec-only/`).

## FINAL (stage D2, d3881fe41)

Final re-shoot, IMPL side, dark + light, on the release client built from `feat/maude-v2` @ `d3881fe41` (all stage C rounds 1-4 merged; client bundle = `fae2884fa`). Every pair in this folder (`<id>-<theme>.jpg`) was overwritten with this shot, replacing every earlier round's. Spec side: **reused** — the board `.design/ui/v2/10 Share and Collaboration.tsx` has not changed since the stage-A shot (`git log` on it is empty after 2026-10-21), so the stage-A spec PNGs were reused. Full-size pairs: `full-size-path.txt` (the "final (D2)" line). No product code touched; no verdicts here (the critic judges).

Harness: the committed `_d-harness-g4` scripts repointed to this worktree, plus `_d2-harness-g4/` (new scripts below). Playwright Chromium 1440x860, `window.__TAURI__` stub unless noted, throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`.

| id | dark · light | note |
|---|---|---|
| co-share-sheet, co-share-roles, co-share-advanced | re-shot | FAKED `/_api/share/*` (cloud, 4 people, 1 invite) |
| co-browser-view, co-presence | re-shot | presence is still one local face (no peers) |
| co-comment-thread, co-comment-video, co-comment-print | re-shot | real comment composer / Comments panel |
| co-sync-offline, co-sync-back | re-shot | FAKED linked project + browser offline + outbox 14; co-sync-back keeps the toast (`notice`) |
| co-conflict, co-trashed, co-local-cloud | re-shot | FAKED conflicts / trash routes; real local Share (Move to cloud) |
| co-access-ends | re-shot | `s10c`: FAKED 401 `access-withdrawn`, notices dismissed |
| co-ask-edit | re-shot | `s10d` frame `co-ask-edit-tip` (view-only tip after a >8 px drag on the faked read-only canvas) is the paired impl |
| co-follow, co-bring, co-spotlight, co-twelve | unreachable | need N live peers (Yjs awareness over `/_ws/collab`); no fixture, no route to fake presence |
| co-mention-notify | unreachable | OS banner / e-mail, native only |

Spec-only JPEGs of the five unreachable ids unchanged (`spec-only/`). New scripts: none beyond `s10 / s10c / s10d`.
