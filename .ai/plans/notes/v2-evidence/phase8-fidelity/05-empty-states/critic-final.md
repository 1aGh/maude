# critic-final — 05 Empty States — V2-8.5 stage D2 (FINAL, merged tip d3881fe41; one critic, four lenses)

Read-only. Every id judged fresh from the "final (D2)" full-size pairs, light and dark. Rules applied: Home = board 11 owns; AI chat = 03; panel chrome = 04/11/14; CONTRACT over board; lead decisions (+ New canvas row, switcher in pill, Connect modal without API-key row) not blockers.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| es-home-cloud | L+D | match | none (Home layout, dot grid, 1080 shelf, avatar, placeholder = board 11) |
| es-home-local | L+D | differs (cannot confirm) | the drawn "No projects on this Mac yet." + "Open project..." card is not shot (impl lists a registered Studio site row); sign-in link sits bare without its island; starters differ |
| es-home-shared | L+D | match | none (stacked vs two column = 11 wins; "Nothing shared with you yet." card, ghosts, words present) |
| es-project-new | L+D | differs | prompt still a ~140 px pill with clipped placeholder "A one-page portfolio wi", grey send (spec 360 card, round azure send) `v2/create/empty-project.css`; panel adds a stray "Studio site" line, search, Make a design system, Recent sort, Trash/Advanced foot where spec shows "0 canvases" |
| es-canvas-ai | L+D | differs | empty block centred on the window (x~0.50) not on the free canvas (spec ~0.59) `v2/empty/empty.css` (R5); panel carries search / Make-a-design-system / Trash / Advanced extras |
| es-landing | L+D | differs (cannot confirm) | the four D2 impl frames are loading cards ("Opening Untitled canvas..." x4 light; dark frame 1 is the project-empty card): the landing (stickies drop, words, Ask AI) is not in any frame; harness caught the wrong state |
| es-canvas-three | L+D | differs | offline frame ok, but "after you send" cards (Drafting / Queued) not shot; Connect frame shows the AI panel under a veil, no centred card visible (cannot confirm); Connect card lacks the "Advanced - Use an API key instead" row (lead-open, DDR-123); dark third frame is a loading card |
| es-artboard-new | L+D | differs | no "Empty artboard." hint card + "Ask AI to fill" chip, no compact inspector, "New artboard" does not select the board, Layers shows "Untitled canvas / Desktop" instead of "No layers on Tablet yet." `v2/empty/empty-host.jsx`, `editing/empty-reporter.tsx` |
| es-panels-canvas | L+D | differs | Version history lists "Changed this canvas . changed outside the app" instead of "Versions appear here as you work." (`history/titles.ts`); Comments tabs carry an extra "All" segment (spec Open/Mine/Resolved); empty-folder frame shows a long chip/list column |
| es-panels-make | L+D | differs | Exports "Every export of this project" (spec "of Studio site"); Trash lacks the "Studio site" chip and adds "Kept until you clear it out."; AI chat follows 03 (no blocker); Assets dashed frame ok |
| es-timeline | L+D | differs | only "No clips on Reel . 9:16 yet." under a full transport bar: no ruler, no drop track with "Cut 15 s" AI chip, no Captions / Music lanes (`v2/timeline/timeline-empty.jsx`); the inspector is now shown but has a poster-frame/Sound/Export set vs spec Preset/Size/Length/Frame rate |
| es-search-k | L+D | match | none ("Did you mean" row = fixture) |
| es-search-more | L+D | differs | Start-here row reads "New canvas..." (ellipsis, `actions/defs/canvas.ts`) vs "New canvas"; Assets no-hits block ("Nothing called ... / Let AI describe your pictures") not shown, impl answers "No images or footage yet." |
| es-search-panel | L+D | match | none (words, spot art, Ask AI chip, "Searched 93 canvases and their artboards" present; foot position + kind chips are warnings, panel chrome owned by 04/11/14) |
| es-filter | L+D | differs | "The one artboard here is web page." missing article (`kinds/layers-kind-model.js:81-82`); Layers rows read raw tags div/h1/p (`canvas-shell.tsx:439-449`); layer tree sits under the empty block; Clear filter lacks the x; chip truncated "Pr... 0" |
| es-viewer | L+D | unreachable | needs a view/comment-only member session (hub / workspace cell vouching a role) |
| es-arriving | L+D | differs | no skeleton artboards ("4 artboards on their way", pulse), panel foot has no progress bar, light canvas shows one centred "Smoke is on its way." card, dark canvas shows nothing (panel still "Loading canvases..." with a "No canvases yet." row) (`shell/viewport.jsx:203`, `v2/empty/skeleton.jsx`, no caller) |
| es-offline-uncached | L+D | differs | block centred on the window, not the free canvas (R5, `empty.css`); status word "Local project" vs "Offline - kept on this Mac"; panel has kind chips + Make-a-design-system where spec has none |
| es-all-trashed | L+D | unreachable | `AllTrashed` never mounts (pair shows "Your canvas is ready."); needs a mount on 0 artboards with the trash holding them + a sync / second-person lane route |
| es-edge-panels | L+D | differs | "Searched 1 chats" (no singular, `empty-copy.js:212`, `ai/ChatList.jsx:430`); "team of one" Share sheet not shot (needs a cloud project) |
