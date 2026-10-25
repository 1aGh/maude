# 10 Share and Collaboration — critic-bar5 (verified bar, D7 shots on 0d2eab1d6)

Judged fresh on the D7 full-size pairs (both themes opened for every reachable id). Checklist: critic-bar4.md + rounds 9/10 notes (INDEX). Lead decisions honoured: contract over board (Comments panel right, 4 filters), Make owner hidden, header x kept, Preview chrome owned by 04, Canvases panel owned by 11, `kept open` chip, trashed canvas stays Viewing, no peer-awareness guess, viewer lands in Preview (harness presses Viewing), first-run card once, faked share API fixtures, `v2-d7-lead-kept-v1-controls-not-extra` (own-comment Edit / Delete comment are kept v1 controls = polish), `v2-p8-c10-misc-thread-heading-wraps-actions`.

**11 verified · 3 differs · 6 unreachable.**

## Per id

- co-share-sheet · verified (light, dark) · none.
- co-share-roles · verified (light, dark) · none (Make owner hidden by lead decision).
- co-share-advanced · verified (light, dark) · none. Values whole, Role live, hint gone, matrix in the fold.
- co-browser-view · verified (light, dark) · none. "Open in the Mac app" island, "Can view" + "Ask to edit" match.
- co-presence · unreachable · multi-peer face stack, cursors, name tags, face menu need live peers.
- co-comment-thread · verified (light, dark) · none. Round 10: heading "Smoke" now readable (min-width), Edit / Resolve / Delete wrap; pin, thread card with reply field + accent send, Comments panel with 4 filters match.
- co-comment-video · differs · (1) the board's frame carries the timeline strip with comment markers and "2 comments on this video" under the picture; the Preview shot (pin + thread card now present, good) has no strip — the strip is an Edit surface (fix-c7-ex10c) and Preview draws none, so the frame lacks a drawn row. Needs a read-only strip in Preview (or the pin + thread card reachable in the Edit frame).
- co-comment-print · verified (light, dark) · none. Legend "Bleed 3 mm · trim · safe margin 5 mm", guides, composer card with position chip and tool dock match.
- co-sync-offline · differs · (1) per-row "not sent" labels in the Canvases list not drawn (no per-canvas pending data); (2) queued-comment bubble "Queued — sends when this Mac is online." not drawn (comments are not an outbox kind). Cluster word and foot match.
- co-sync-back · differs · (1) per-row "sending" labels not drawn (same data gap). Toast, "Syncing…" and foot "Sending 14 changes · N sent" match.
- co-conflict · verified (light, dark) · none. Decision card on the canvas, no x, Keep yours / Jonas's / Keep both, Version history card match. Dark: the "Yours · this Mac" / "Jonas · their Mac" labels sit on the white fixture artboard (light grey on white) — fixture backdrop, polish.
- co-trashed · verified (light, dark) · none. Top banner with Restore, two-line selected ghost row, Viewing with no Edit dock by lead decision.
- co-local-cloud · verified (light, dark) · none. Sheet under the ringed Share cluster ("Local project" word in the raw frame), words match.
- co-ask-edit · verified (light, dark) · none. Tip beside the pointer with the board's words, "Can view" + pressed eye + accent "Ask to edit".
- co-access-ends · verified (light, dark) · none.
- co-follow, co-bring, co-spotlight, co-twelve · unreachable · need N live awareness peers.
- co-mention-notify · unreachable · OS banner + hub e-mail.

## Polish list

- co-share-sheet · header x (lead decision); Petra face grey; fixture rows (Team row, "+ 9 in project", "You").
- co-share-roles · "Whole project — Lukáš sees all 93" caption has no string.
- co-share-advanced · "This Mac only" label/value wrap; Expires "Never" and Last synced "00:28" vs board "6 Oct, 14:05 · 247 assets" (no source); `kept open` chip is the kit fold row; matrix inside the fold.
- co-browser-view · no peer faces / cursors (fixture); folded crumb + Preview pill are 04's; first-run "What's new" notice.
- co-comment-thread · Edit / Delete comment own-comment controls (kept v1); heading names canvas not artboard; two-letter "MR" face in the card; panel stretches full height for one row; one comment vs four; fixture canvas.
- co-comment-video · existing Tereza / Jonas replies fixture; no accent ring at the playhead marker; no clip thumbnails (07's); Edit / Delete comment own-comment controls.
- co-comment-print · position chip wording depends on click point; existing Jonas thread vs new composer (state); amber preflight badges on artboard names (08's); size tag 10 px.
- co-sync-offline / co-sync-back · Canvases panel is the flat 11-owned list with filter chips, Recent group, Trash row (board draws the folder tree); Edit chrome vs board's Preview + annotate toolbar; fixture canvas names.
- co-conflict · Version history 2 entries (board 3); Edit toolbar instead of annotate; sticky text fixture; labels over white fixture artboard in dark.
- co-trashed · flat 11-owned list instead of folder tree; real Print row below the ghost row (faked listing); Viewing + no Edit cluster / dock (recorded lead deviation); fixture names.
- co-local-cloud · "Share on a local project" flag is a board annotation; project name fixture.
- co-ask-edit · Mac-window frame and "On Petra's Mac" label are board annotations; viewer lands in Preview by lead decision.
- co-access-ends · dim canvas behind is the fixture video; Mac-window frame annotation.

## Side states

- co-sync-offline/tooltip · "Invites send when this Mac is online." under Share on hover / focus · reachable (code shipped, not shot).
- co-sync-back/needs-a-look · "one sticky needs a look · Show" in the toast, "Tereza changed this · 09:15" tag, "2 versions" mark · unreachable (second person).
- co-conflict/version-history · card beside the pair with the Tereza row and 3 entries · reachable, shot with 2 entries (card itself verified).
- co-comment-thread/mention-picker · @ picker row with role · unreachable (peers).
- co-comment-thread/existing-replies · Jonas / Tereza replies · unreachable (other authors).
- co-comment-thread/own-comment · Edit / Delete comment on the viewer's own thread · reachable, shot.
- co-comment-video/existing-replies · Tereza / Jonas thread on the picture · unreachable (other authors).
- co-ask-edit/owner-request · "Petra asks to edit" card at the top of the owner's Share · reachable via faked `/_api/share/requests`, not shot.
- co-ask-edit/edit-granted · toast "You can edit Combine-kampan now." · unreachable (owner's answer).
- co-ask-edit/ask-sent · "Ask a project owner for edit access." toast · reachable, raw frame `-ask`.
- co-access-ends/remove-confirm · owner "Remove Lukáš from Alligators brand?" dialog · reachable (faked share API), not shot.
- co-access-ends/link-off · viewer "This link was turned off." card · reachable (faked 401), not shot.
- co-presence/face-menu · Follow / Go to / peer's AI / Bring everyone here · unreachable (peers).
- co-share-sheet/team-row · "Everyone in <project>" row and "+ N in <project>" · reachable once the faked API sends project people.
- co-share-advanced/self-hosted-hub · "Roles on this hub" sheet · unreachable (needs a self-hosted hub).
