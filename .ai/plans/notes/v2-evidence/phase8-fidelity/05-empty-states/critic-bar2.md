# critic-bar2 - 05 Empty States - re-evaluated against the "verified" bar (v2-michal-verified-bar), D3 tip 63592219a
Source: critic-final-d3.md + full-size D3 pairs (borderline ones opened). No new shots. Lead decisions applied: Home = board 11, AI chat = 03, panel chrome = 04/11/14, inspector = 14/08, CONTRACT over board, Connect modal without API-key row.

## Verdicts
- es-home-cloud · verified (L+D) · none
- es-home-local · differs · the drawn empty state ("No projects on this Mac yet." card + Open project... + ghost thumbs) is not shot (harness registered a Studio site project; state itself reachable with no registered project); sign-in link has no island (re-check once the right state is shot)
- es-home-shared · verified (L+D) · none
- es-project-new · differs · left panel has a SECOND "+ New canvas" row under a stray "Studio site" label line (spec: one row, "0 canvases") = extra control/content (`tree/tree.jsx` empty branch, `v2/create/empty-project.css`)
- es-canvas-ai · verified (L+D) · none
- es-landing · verified light; dark unconfirmed · dark impl frames are all loading cards (harness capture), landing never shot
- es-canvas-three · verified (L+D) main frames (online / offline / not-connected canvas, words OK; "New artboard" = CONTRACT) · none; after-send and Connect frames are side rows
- es-artboard-new · verified (L+D) · none
- es-panels-canvas · verified (L+D) main (empty folder + Comments none ok; extra "All" tab = CONTRACT) · none; the other frames are side rows
- es-panels-make · verified (L+D) main (AI chat per 03, Assets, Exports ok) · none; Trash is a side row that differs
- es-timeline · differs · timeline panel has no ruler (0:00-0:30), no empty drop track, no Captions / Music lanes (`v2/timeline/timeline-empty.jsx`); inspector difference is 08's (lead decision, not a blocker)
- es-search-k · verified (L+D) · none
- es-search-more · verified (L+D) main (⌘K nothing recent + Start here) · none; Assets no-hits is a side row
- es-search-panel · verified (L+D) · none
- es-filter · differs · filter chip has no x and is truncated "Pr... 0"; "Clear filter" lacks its x glyph; layer tree rendered under the empty block (spec shows only the empty block) (`canvas-shell.tsx`, `kinds/layers-kind-model.js`)
- es-viewer · unreachable · needs a view/comment-only member session (hub role)
- es-arriving · differs · no skeleton artboards ("4 artboards on their way", pulse), foot without progress bar / Syncing... word; canvas shows a single centred card (`v2/empty/skeleton.jsx` has no caller)
- es-offline-uncached · differs · light: block centred on the window instead of the free canvas (~130 px off = anchoring); dark: wrong state shot ("Loading canvases..." + "No canvases yet.", no "isn't on this Mac yet" card) - harness
- es-all-trashed · unreachable · every artboard in the Trash only arises via sync / a second person (UI refuses to trash the last artboard)
- es-edge-panels · verified (L+D) main (chat search no hits, "Searched 1 chat") · none; team-of-one Share sheet is a side row

## Polish list
- es-project-new · prompt shows azure focus ring instead of the raised white card; search row + Advanced row in the panel (04/11 chrome)
- es-home-cloud / es-home-shared · "Recent canvases" row + two-column shelf follow board 11; ghost words generic vs names (fixture)
- es-canvas-ai · extra "New artboard" button (CONTRACT); panel extras 04/11/14
- es-canvas-three · status word "Local project" vs Offline/Saved (fixture / hub); third frame has a comments panel open (fixture)
- es-panels-canvas · Version history shows a "Changed this canvas" row (fixture); panels are a full-height column / smaller 
- es-panels-make · AI chat has no suggestion chips (03 owns); sits in left panel column
- es-timeline · poster frame / sound / export inspector rows (08)
- es-search-k · no "Did you mean Pricing" row (fixture has no Pricing canvas); palette wider
- es-offline-uncached · status word "Local project" vs "Offline - kept on this Mac" (hub-linked fixture); panel kind chips
- es-filter · spec wording "still on from Combine-kampan. All 5 artboards..." vs impl (fixture)
- all · no undo/zoom chip when Zoom controls off, no native tab strip in browser lane (harness)

## Side states
- es-canvas-three/drafting ("Drafting About us...") · needs an AI run · unreachable (e2e later)
- es-canvas-three/queued ("Queued - sends when this Mac is online.") · offline send · reachable, not shot
- es-canvas-three/connect (Connect your Claude account? card, no API-key row) · first send signed-out · reachable, not shot (impl shows a faint panel)
- es-panels-canvas/comments-all-resolved ("All done." + confetti) · blank frame in the shot · reachable, not shot
- es-panels-canvas/version-history ("Versions appear here as you work.") · fixture row hides it · reachable
- es-panels-make/trash · differs: no "Studio site" chip, extra "Kept until you clear it out." · reachable (needs a fix in `left-panel/trash-view.jsx`)
- es-search-more/assets-no-hits ("Nothing called ...", "Let AI describe your pictures") · needs a project with assets · reachable, not shot
- es-edge-panels/team-of-one (Share sheet, empty people list) · needs a cloud project · unreachable (hub)
