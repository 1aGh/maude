# 10 Share and Collaboration — critic-bar3 (verified bar, D5 shots on e37e7d82a)

Judged fresh on the D5 pairs (both themes read for every id; full-size impl frames opened for trashed, conflict, browser-view, comment-thread, comment-print, comment-video, local-cloud, ask-edit). Checklist: critic-bar2.md + fix-c7-ex10 / ex10b / ex10c. Lead decisions honoured: contract over board (Comments panel right, 4 filters), Make owner hidden, header x kept, Preview chrome owned by 04 (project crumb folds, "Previewing X" pill), Canvases panel owned by 11 (flat list vs folder tree), `kept open` chip = kit fold row, `v2-p8-c7-trashed-open-stays-viewing` (Viewing, no edit dock), `v2-p8-c7-no-peer-awareness-guess` (no faked peer AI row / "changed this" tag), faked share API fixtures.

**8 verified · 6 differs · 6 unreachable.**

## Per id

- co-share-sheet · verified (light, dark) · none. Title, tabs, invite row, people list with Resend, link row, Advanced fold match; Team row / "+ 9 in project" / "You" are fixture (faked API sends no project people).
- co-share-roles · verified (light, dark) · none. Menu items, check, captions, red Remove match; Make owner hidden by lead decision.
- co-share-advanced · differs · (1) App link / This Mac / Hub values are still cut with an ellipsis ("maude://open/project…", "http://localhost:50…", "https://alligators.c…"), so the link cannot be read (board: full mono value, right aligned); (2) extra hint line "Opens the folder on this Mac only." under App link (board none; ex10 left it open); (3) the Role row is a disabled select in this state (board: live select).
- co-browser-view · verified (light, dark) · none. "Open in the Mac app" island now drawn bottom right in both themes, "Can view" + "Ask to edit" cluster matches. Missing project crumb, the "Previewing Print" pill and the first-run "What's new" notice are Preview chrome (04) / fresh-profile shell, not this board.
- co-presence · unreachable · multi-peer face stack, Follow / Go to / peer AI / Bring everyone here, cursors and name tags need live awareness peers; own face + "Local project" word render.
- co-comment-thread · verified (light, dark) · none. Thread card (heading, ghost Resolve, close, reply field with accent send), pin on tone disc, 4-filter panel with close, comment tool dock match (panel right by contract).
- co-comment-video · differs · (1) the board's frame is the comment state on the video: Comment tool active in the dock, pin on the picture, thread card with the new-comment field; the shot is Edit with the trailer selected, an inspector panel open (board none), the Edit dock and no thread card or pin; (2) timeline strip with markers and "2 comments on this video" is now drawn (ok), but the marker at the playhead has no accent ring. ex10c: the strip is an Edit surface, so the board's Preview + Comment tool combination is not shot.
- co-comment-print · differs · (1) print guides and the "Bleed 3 mm · trim · safe margin 5 mm" legend are not in the shot: the artboards show no guide outlines at all, although ex10 says the harness turns Print guides on; (2) the "105 x 148 mm" tag on artboard B (board draws none in this state) is now on the HUD tokens (contrast ok, not a blocker). Composer card, position chip ("14 mm from the left · 63 mm from the top"), tool dock match; existing Jonas reply is fixture.
- co-sync-offline · differs · (1) per-row "not sent" labels in the canvas list not drawn (no per-canvas pending data); (2) the queued comment bubble "Queued — sends when this Mac is online." on the canvas is not drawn. Cluster word "Offline — kept on this Mac" and foot "14 changes since yesterday 18:20 — kept on this Mac" match.
- co-sync-back · differs · per-row "sending" labels in the canvas list not drawn (same missing per-canvas pending data). Top toast "Back online. Your changes are going up", "Syncing…" cluster word and foot match; "needs a look" part of the toast and the Tereza tag are the unreachable side state.
- co-conflict · verified (light, dark) · none. Decision card is on the canvas above the pair, no x, Keep yours / Keep Jonas's under their stickies, Keep both attached below, "or", yellow stickies, Yours · this Mac / Jonas · their Mac lines, Version history card with Restore and the kbd hint all match. Timestamps in the sticky lines, third Tereza entry are fixture.
- co-trashed · verified (light, dark) · none. Top banner (trash chip, "Tereza moved Print to the trash · 2 min ago", "You can keep looking. Your unsent changes stay with it.", Restore) matches; the ghost row is two lines ("In the trash · open here") on the selected row; Viewing mode with no Edit dock follows the lead decision (the board's own copy says editing stops).
- co-local-cloud · verified (light, dark) · none. Sheet under the Share cluster, heading, body, Cancel / Move to cloud, "Only need a file? Menu › Export… ⇧⌘E" match word for word.
- co-ask-edit · differs · the dark view-only tip ("You can look at …, not change it. Ask to edit, top right, sends a request to its owner.") is NOT in the merged-tip shot in either theme: the `-tip` and `-rel` frames show the plain Preview viewer with no tip (only the `-ask` frame shows a toast), so the behaviour the board draws (tip beside the pointer after a drag) is not evidenced after the x/y change. Cluster "Can view" + accent "Ask to edit" match. The viewer lands in Preview (eye pressed) where the board has Viewing pressed.
- co-access-ends · verified (light, dark) · none. Card 340 px, lock chip, title, body, "Back to Home" with home glyph, words match. The dim canvas behind is fixture.
- co-follow, co-bring, co-spotlight, co-twelve · unreachable · need N live awareness peers.
- co-mention-notify · unreachable · OS banner + hub e-mail.

## Polish list

- co-share-sheet · header x (lead decision); Petra's pending face is grey vs a tone face; fixture rows (Team row, "+ 9 in project", "You", "Invited 2 days ago").
- co-share-roles · "Whole project — Lukáš sees all 93" caption has no string.
- co-share-advanced · Expires "Never" and Last synced "14:04" vs "6 Oct, 14:05 · 247 assets" (no asset-count source); `kept open` chip is the kit fold row.
- co-browser-view · no peer faces / cursors (fixture); project crumb folded and the Preview pill are 04's chrome; the "What's new" notice appears on a fresh profile.
- co-comment-thread · panel stretches full height for one row; thread header names the canvas, board names the artboard; author face shows two letters "IA" in the card (pin and panel one); extra canvas group heading in the panel; one comment vs four (fixture).
- co-comment-video · existing Tereza / Jonas replies are fixture.
- co-comment-print · size tag text 10 px; position-chip words depend on the click point; existing reply fixture.
- co-sync-offline / co-sync-back · Canvases panel is the flat 11-owned list with filter chips and Trash row, board draws the folder tree; fixture canvas names.
- co-conflict · Version history has 2 entries (board 3); sticky timestamps absent; sticky text and the artboards behind are fixture.
- co-trashed · flat 11-owned list instead of the folder tree; the real Print row stays under the ghost row (faked trash listing); Viewing + no Edit cluster / dock is the recorded lead deviation (`v2-p8-c7-trashed-open-stays-viewing`); face letter Y vs T.
- co-local-cloud · crop omits the "Local project" cluster and the "Share on a local project" flag (flag is a board annotation); project name fixture.
- co-ask-edit · board has the Mac-window frame and the "On Petra's Mac" label (board annotation).
- co-access-ends · the dim canvas is the fixture video.

## Side states

- co-sync-offline/tooltip · "Invites send when this Mac is online." under Share (hover / focus) · reachable (code shipped, not shot).
- co-sync-back/needs-a-look · "one sticky needs a look · Show" in the toast, "Tereza changed this · 09:15" tag, "2 versions" mark · unreachable (second person).
- co-conflict/version-history · card beside the pair with Tereza row and 3 entries; impl card shown with 2 entries, right of the pair · reachable, shot.
- co-comment-thread/mention-picker · @ picker row with role · unreachable (peers).
- co-comment-thread/existing-replies · Jonas / Tereza replies · unreachable (other authors).
- co-ask-edit/owner-request · "Petra asks to edit" card at the top of the owner's Share (Not now / Let Petra edit) · reachable via faked `/_api/share/requests`, not shot.
- co-ask-edit/edit-granted · toast "You can edit Combine-kampan now." · unreachable (needs the owner's answer).
- co-ask-edit/ask-sent · "Ask a project owner for edit access." toast after Ask to edit · reachable, shot (`-ask` frame).
- co-access-ends/remove-confirm · owner "Remove Lukáš from Alligators brand?" dialog over the share sheet · reachable (faked share API), not shot.
- co-access-ends/link-off · viewer "This link was turned off." card · reachable (faked 401), not shot.
- co-presence/face-menu · Follow / Go to / Tereza's AI / Bring everyone here · unreachable (peers).
- co-share-sheet/team-row · "Everyone in <project>" row and "+ N in <project>" · reachable once the faked API sends project people.
- co-comment-video/preview-comment · Preview with the Comment tool, pin and thread card over the video · reachable only if 04/07 allow a read-only timeline strip.
