# 10 Share and Collaboration — critic-bar2 (verified bar, D4 shots on 21c9714cf)

Judged fresh on the D4 pairs (both themes read for every id), raw impl frames opened where a size was borderline (co-access-ends card is 340 px / type-md in the 1440 frame: the D3 "220 px" finding was a downscale artefact). Checklist: critic-final-d3.md. Lead decisions respected: contract over board (Comments panel right, 4 filters), Make owner hidden, header x kept, Preview chrome owned by 04, Canvases panel owned by 11, `kept open` chip is the kit fold row (06).

**5 verified · 9 differs · 6 unreachable.**

## Per id

- co-share-sheet · verified (dark, light) · none. Team row, "+ 9 in <project>", "Invited 2 days ago", "You" owner row are fixture (code exists: `teamRow`/`restLine`/`invitedAgo`; the faked share API sends no project people / `invitedAt` / self id).
- co-share-roles · verified (dark, light) · none. Make owner hidden by lead decision; scope captions are not in the shot frame either side.
- co-share-advanced · differs · (1) App link / This Mac / Hub values are truncated outlined boxes with a copy glyph, so the link cannot be read (board: full mono value inline, right aligned, no box); (2) stacked extra hint "Opens the folder on this Mac only." (board none); (3) last line "Sync details live in Menu > Diagnostics > Sync." is clipped at the bottom of the sheet.
- co-browser-view · differs · (1) "Open in the Mac app" island (bottom right, drawn by the board) is absent in this frame: the shot ran with the `__TAURI__` stub, which by design hides it (it shows in the plain-browser access-ends frame), so re-shoot without the stub; (2) viewer sees no project name (folded "Previewing Print" pill; Preview chrome is 04's, so this is only listed). Faces/peers are fixture.
- co-presence · unreachable · the board is the multi-peer state (face stack + "+4", Follow / Go to / Tereza's AI / Bring everyone here, cursors, name tags, AI tags); needs second people. Own face and "Local project" word render.
- co-comment-thread · verified (dark, light) · none. Thread card (canvas heading, ghost Resolve, one field with accent send), pin on a tone disc with initial, panel with 4 filters and close, comment tool dock all match.
- co-comment-video · differs · timeline strip under the clip with comment markers and "2 comments on this video" is not drawn (product not built, fix-share "NOT done"); the composer card is the new-comment state, existing Tereza/Jonas replies are fixture.
- co-comment-print · differs · (1) print guides + "Bleed 3 mm · trim · safe margin 5 mm" legend are absent (guides toggle default off: reachable, shoot with guides on); (2) the white-on-accent "105 x 148 mm" size tag (`inspect-overlay.tsx` `.dc-cv-inspect-tag`: hard-coded `#ffffff` on the 0d99ff fallback, 10 px) is about 2.9:1, an AA fail, and the board draws no such tag in this state. Position-chip words ("from the top" vs "above the trim") are position-dependent, fixture.
- co-sync-offline · differs · per-row "not sent" labels in the canvas list and the queued comment bubble ("Queued — sends when this Mac is online.") are not drawn: no per-canvas pending data. Cluster word and the foot "14 changes since yesterday 18:20 — kept on this Mac" now match.
- co-sync-back · differs · per-row "sending" labels in the canvas list are not drawn (same missing per-canvas pending data). Pill toast with sync icon, "Syncing…" word and foot match; foot counts are fixture.
- co-conflict · differs · decision card is a top banner fixed over the Canvases panel with an x; the board puts it on the canvas under the pair with no x; "Keep both" floats detached lower-left instead of under the pair. Stickies, yellow tone, "Yours · this Mac" / "Jonas · their Mac" lines and Keep yours / Keep Jonas's match.
- co-trashed · differs · the ghost row "Print · In the trash · open h..." is truncated on one line (board: two-line row, selected, thumbnail, "open here" readable); the shell is in Viewing (no face, no Saved, Preview pressed, hand+frame dock) where the board keeps the Edit cluster and Edit dock. Banner (top, chip, copy, Restore) matches.
- co-local-cloud · verified (dark, light) · none. Sheet matches word for word and in style (heading, body, Cancel / Move to cloud, shift-cmd-E hint); the crop omits the "Local project" cluster, evidenced in the co-presence frame.
- co-ask-edit · differs · the dark tip is anchored under the Ask to edit cluster; the board anchors it beside the pointer. Tip words and Can view / Ask to edit cluster match.
- co-access-ends · verified (dark, light) · none. Card 340 px, 20 px radius, lock chip, type-md title, home glyph on Back to Home, copy match.
- co-follow, co-bring, co-spotlight, co-twelve · unreachable · need N live awareness peers.
- co-mention-notify · unreachable · OS banner + e-mail.

## Polish list

- co-share-sheet · header x drawn (lead decision, kept); Petra's pending face is grey, board is a tone face; fixture rows listed above.
- co-share-roles · "Whole project — Lukáš sees all 93" caption has no string.
- co-share-advanced · Role select disabled / Expires "Never" / Last synced clock vs "6 Oct, 14:05 · 247 assets" (fixture; no asset-count source); `kept open` chip is the kit fold row.
- co-comment-thread · Comments panel stretches full height for one row (board: compact card); thread header names the canvas, board names the artboard ("A4 · plakát"); author face shows two letters "IA" (pin and panel show one); extra canvas group heading in the panel; "Previewing Smoke" pill is 04's.
- co-comment-video · send button reads washed in the composer (disabled state, light).
- co-sync-offline / co-sync-back · Canvases panel is the flat 11-owned list with filter chips, board draws the folder tree.
- co-local-cloud · crop omits the cluster and the "Share on a local project" flag (flag is a board annotation).
- co-access-ends · dim canvas is the fixture video; "Back to Home" in the shot is correct size.

## Side states

- co-sync-offline/tooltip · "Invites send when this Mac is online." under Share (hover / focus) · reachable (code shipped, not shot).
- co-sync-back/needs-a-look · "one sticky needs a look · Show" in the toast, "Tereza changed this · 09:15" tag, "2 versions" mark · unreachable (second person).
- co-conflict/version-history · card beside the pair with Tereza row and 3 entries; impl popover overlaps the artboard top-right with 2 entries · reachable, shot, placement differs.
- co-comment-thread/mention-picker · @ picker row with role · unreachable (peers).
- co-comment-thread/existing-replies · Jonas / Tereza replies and typed reply · unreachable (other authors).
- co-ask-edit/owner-request · "Petra asks to edit" request card at the top of the owner's Share (Not now / Let Petra edit) · reachable via faked `/_api/share/requests`, not shot.
- co-ask-edit/edit-granted · toast "You can edit Combine-kampan now." · unreachable (needs the owner's answer).
- co-access-ends/remove-confirm · owner "Remove Lukáš from Alligators brand?" dialog over the share sheet · reachable (faked share API), not shot.
- co-access-ends/link-off · viewer "This link was turned off." card · reachable (faked 401), not shot.
- co-presence/face-menu · Follow / Go to / Tereza's AI / Bring everyone here · unreachable (peers).
- co-share-sheet/team-row · "Everyone in <project>" row and "+ N in <project>" · reachable once the faked API sends project people.
