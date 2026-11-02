# critic-bar4 - 05 Empty States - "verified" bar (v2-michal-verified-bar), D6 tip 3d58f57df
Source: D6 pairs (committed jpgs, both themes read for every id; full-size opened for es-canvas-three), critic-bar3.md, fix-c7-oboard.md (round 7 + round 8 table), kg v2-p8-c7 / v2-p8-c8. Lead decisions applied: Home = board 11, AI chat = 03, panel chrome = 04/11/14, inspector = 14/08, CONTRACT over board (extra "New artboard", "All" tab), Connect modal without API-key row, first-run card once (c8), arriving skeleton deferred (c8). No new shots.

## Verdicts (id · verdict · remaining MUST items)
- es-home-cloud · verified (L+D) · none
- es-home-local · verified (L+D) · none (round 8 first-run-once: empty shelf "No projects on this Mac yet." + "Open project..." + quiet "Sign in to cloud.maude.sh" pill now shot in both themes)
- es-home-shared · verified (L+D) · none
- es-project-new · verified (L+D) · none
- es-canvas-ai · verified (L+D) · none
- es-landing · verified (L+D) · none
- es-canvas-three · verified (L+D) main frames (online / offline with "AI is back when this Mac is online." / not connected) · none
- es-artboard-new · verified (L+D) · none
- es-panels-canvas · verified (L+D) main (empty folder, Comments none, All done., Version history) · none
- es-panels-make · verified (L+D) main (AI chat per 03, Assets, Exports, Trash) · none
- es-timeline · verified (L+D) · none
- es-search-k · verified (L+D) · none
- es-search-more · verified (L+D) main (Cmd-K nothing opened yet + Start here) · none
- es-search-panel · verified (L+D) · none
- es-filter · verified (L+D) · none
- es-viewer · unreachable · needs a view/comment-only member session (hub role); e2e
- es-arriving · verified (L+D) · none. Centred "X is on its way." card on the free canvas, panel foot "Getting ... 41 of 93 canvases" with the 4 px progress bar. The skeleton artboards + "N artboards on their way" tag are a recorded lead deviation (v2-p8-c8-arriving-skeleton-deferred: no per-artboard arrival state in sync) -> polish, not MUST
- es-offline-uncached · verified (L+D) · none
- es-all-trashed · unreachable · board draws a peer (Jonas) trashing every artboard (needs a second person). Own-trash variant renders the card in both themes (dark: "Two has no artboards left."); light shot's second frame caught "Your canvas is ready" (timing). Ghost outlines + connector of trashed artboards not drawn. Verify in e2e with two sessions
- es-edge-panels · verified (L+D) main (chat search, no hits) · none

## Polish list
- es-home-cloud / es-home-shared · "Recent canvases" row + two-column shelf follow board 11; ghost thumb words / names (fixture)
- es-home-local · quiet sign-in pill sits at the far right of the island, spec beside the search chip; prompt placeholder / chip words (fixture)
- es-project-new · prompt shows the azure focus ring instead of the raised white card; search + Advanced rows in the panel (04/11 chrome); "What's new" toast in the corner (harness notice); project name Studio site vs Portfolio 2026 (fixture)
- es-canvas-ai · extra "New artboard" button (CONTRACT); panel list is one "Untitled canvas" (fixture)
- es-landing · harness picks frames from a sequence, so frame 1 already has stickies; extra "New artboard" button (CONTRACT)
- es-canvas-three · status word "Local project" vs Offline/Saved (fixture / hub); frame 2 carries a different panel set (fixture)
- es-artboard-new · artboard names / sizes (fixture); Desktop vs Tablet
- es-panels-canvas · Version history shows a "Changed this canvas" row (fixture); panels are full-height columns
- es-panels-make · AI chat has no hero + suggestion chips (03 owns); Exports "Export..." has no Shift-Cmd-E keycap in the browser shot; panels sit in the left column
- es-timeline · no "38 clips ... ready in Assets" line and no "Cut 15 s from these clips" button (fixture has no assets); poster-frame / sound / export inspector rows (08); extra timeline toolbar
- es-search-k · no "Did you mean Pricing" row (fixture has no Pricing canvas); palette wider
- es-search-panel · extra kind-chip row in the panel (04/11 chrome); canvas shows 90+ cards (fixture)
- es-filter · wording "still on from Combine-kampan. All 5 artboards..." vs "The one artboard here is fixed size" (fixture); project label line above the block absent (+-4 px class)
- es-arriving · skeleton artboards + "N artboards on their way" tag deferred (lead, c8); panel arriving rows (pulsing thumbs) not visible (fixture); card text "Smoke is on its way."
- es-offline-uncached · status word "Local project" vs "Offline - kept on this Mac" (hub-linked fixture); panel kind chips
- es-edge-panels · crop size differs; "1 chat" vs "41 chats" (fixture)
- all · no native tab strip in the browser lane, zoom controls (harness)

## Side states
- es-canvas-three/drafting ("Drafting About us...") · needs an AI run · unreachable (e2e)
- es-canvas-three/queued ("Queued - sends when this Mac is online.") · offline send · reachable, not shot
- es-canvas-three/connect (Connect your Claude account? card, no API-key row) · first send signed-out · reachable; the impl frame is a faded panel, the card is not legible
- es-panels-canvas/comments-all-resolved ("All done.") · shot shows it, matches · reachable
- es-panels-canvas/version-history ("Versions appear here as you work.") · fixture row hides it · reachable
- es-panels-make/trash · "Trash is empty." shown; chip words differ (no "Studio site" chip, extra "Kept until you clear it out.") · reachable
- es-search-more/assets-no-hits ("Nothing called ...", "Let AI describe your pictures") · shot shows the plain empty Assets state, not the no-hits one · reachable
- es-edge-panels/team-of-one (Share sheet, empty people list) · needs a cloud project · unreachable (hub)
- es-all-trashed/peer-trash · second person · unreachable (e2e)
