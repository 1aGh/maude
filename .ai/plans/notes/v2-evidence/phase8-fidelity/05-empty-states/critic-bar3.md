# critic-bar3 - 05 Empty States - "verified" bar (v2-michal-verified-bar), D5 tip e37e7d82a
Source: D5 pairs (committed jpgs, full-size opened for borderline ids), critic-bar2.md, fix-c7-oboard.md, kg `v2-p8-c7-*`. Lead decisions applied: Home = board 11, AI chat = 03, panel chrome = 04/11/14, inspector = 14/08, CONTRACT over board (extra "New artboard", "All" tab), Connect modal without API-key row. No new shots.

## Verdicts (id · verdict · remaining MUST items)
- es-home-cloud · verified (L+D) · none
- es-home-local · differs · the drawn state (signed out, no project, shelf card "No projects on this Mac yet." + Open project... + quiet "Sign in to cloud.maude.sh" pill) is still not the shot state: zero projects + signed out lands on the first-run sign-in card (`isFirstRun` -> `cardOn`, `home/home-app.jsx`), which replaces the shelf (`home/Shelves.jsx` local-empty variant never reached) and hides the quiet pill. Reachable with no AI/hub
- es-home-shared · verified (L+D) · none
- es-project-new · verified (L+D) · none (one "New canvas" row now; search + Advanced rows = 04/11 chrome)
- es-canvas-ai · verified (L+D) · none
- es-landing · verified (L+D) · none (dark frames now real; the 0 ms frame of the harness sequence is the "Opening..." card, not a product gap)
- es-canvas-three · verified (L+D) main frames (online / offline / not connected) · none
- es-artboard-new · verified (L+D) · none
- es-panels-canvas · verified (L+D) main (empty folder, Comments none) · none
- es-panels-make · verified (L+D) main (AI chat per 03, Assets, Exports) · none
- es-timeline · verified (L+D) · none (ruler 0:00-0:30, dashed drop track, Captions + Music lanes now present; inspector rows = 08)
- es-search-k · verified (L+D) · none
- es-search-more · verified (L+D) main (Cmd-K nothing opened yet + Start here) · none
- es-search-panel · verified (L+D) · none
- es-filter · verified (L+D) · none (chip keeps word + count + x, "Clear filter" ghost button with x, no layer tree under the block)
- es-viewer · unreachable · needs a view/comment-only member session (hub role)
- es-arriving · differs · (1) canvas has no skeleton artboards and no "N artboards on their way" tag (`SkeletonArtboard` in `v2/empty/skeleton.jsx` still has no caller; only the centred card was added in round 7); (2) panel foot shows the "Getting ... 41 of 93 canvases" words but no progress bar; (3) panel arriving rows (pulsing thumbs) not visible in the shot
- es-offline-uncached · verified (L+D) · none (card centred on the free canvas, dimmed rows, "Show canvases on this Mac")
- es-all-trashed · unreachable · the drawn state is a peer (Jonas) trashing every artboard; needs a second person. Own-trash variant renders the card in the dark shot; the light shot caught the "Your canvas is ready" frame (timing), and the dashed ghost outlines + connector of the trashed artboards are not drawn in either. Re-check in e2e with two sessions
- es-edge-panels · verified (L+D) main (chat search, no hits) · none

## Polish list
- es-home-cloud / es-home-shared · "Recent canvases" row + two-column shelf follow board 11; ghost thumb words / names (fixture)
- es-project-new · prompt shows the azure focus ring instead of the raised white card; search + Advanced rows in the panel (04/11 chrome); "What's new" toast in the corner (harness notice)
- es-canvas-ai · extra "New artboard" button (CONTRACT); panel list is one "Untitled canvas" (fixture)
- es-landing · harness picks frames from a sequence, so frame 1 already has two stickies; extra "New artboard" button (CONTRACT)
- es-canvas-three · status word "Local project" vs Offline/Saved (fixture / hub); second frame carries Comments + chat panels open (fixture)
- es-panels-canvas · Version history shows a "Changed this canvas" row (fixture); panels are full-height columns
- es-panels-make · AI chat has no hero + suggestion chips (03 owns); Exports "Export..." has no Shift-Cmd-E keycap in the browser shot; sits in the left panel column
- es-timeline · no "38 clips ... ready in Assets" line and no "Cut 15 s from these clips" button (fixture has no assets); poster frame / sound / export inspector rows (08); extra timeline toolbar
- es-search-k · no "Did you mean Pricing" row (fixture has no Pricing canvas); palette wider
- es-search-panel · extra kind-chip row in the panel (04/11 chrome)
- es-filter · wording "still on from Combine-kampan. All 5 artboards..." vs "The one artboard here is fixed size" (fixture); the project label line above the block is absent (+-4 px class)
- es-offline-uncached · status word "Local project" vs "Offline - kept on this Mac" (hub-linked fixture); panel kind chips
- es-artboard-new · artboard names / sizes (fixture); Desktop vs Tablet
- all · no native tab strip in the browser lane, Zoom controls (harness)

## Side states
- es-canvas-three/drafting ("Drafting About us...") · needs an AI run · unreachable (e2e later)
- es-canvas-three/queued ("Queued - sends when this Mac is online.") · offline send · reachable, not shot
- es-canvas-three/connect (Connect your Claude account? card, no API-key row) · first send signed-out · reachable; impl frame is a faint panel, the card is not visible
- es-panels-canvas/comments-all-resolved ("All done.") · shot now shows it, matches · reachable
- es-panels-canvas/version-history ("Versions appear here as you work.") · fixture row hides it · reachable
- es-panels-make/trash · differs: no "Studio site" chip, extra "Kept until you clear it out." · reachable (`left-panel/trash-view.jsx`)
- es-search-more/assets-no-hits ("Nothing called ...", "Let AI describe your pictures") · shot shows the plain empty Assets state, not the no-hits one · reachable
- es-edge-panels/team-of-one (Share sheet, empty people list) · needs a cloud project · unreachable (hub)
