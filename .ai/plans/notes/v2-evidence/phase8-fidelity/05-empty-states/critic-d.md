# critic-d — 05 Empty States — V2-8.5 stage D re-check (one critic, four lenses)

Read-only. Pairs: stage D (impl re-shot on 2739edc35, spec reused). Owning-board rule applied: Home layout/dot grid/shelf width/avatar follow 11 (not 05); AI-chat empty follows 03; left-panel chrome (docked column, kind chips, Trash/Advanced foot) follows 04/11/14; CONTRACT wins over the board (filter "All" tab, "New artboard", full empty-canvas line). Dark pairs were read for every id; each shows the same state and defects as its light pair unless noted.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| es-home-cloud | L+D | match | none (placeholder words, dot grid, 1080 shelf, avatar = copy warning / board 11 owns) |
| es-home-local | L+D | differs (cannot confirm) | design/copy: the drawn state "No projects on this Mac yet" + "Open project… ⌘O" card is not shot (impl shows a registered Studio site row; first-run card vs shelf ruling in fix-nav); sign-in sits bare without its island; starters/placeholder differ |
| es-home-shared | L+D | match | none (stacked vs two-column = 11 wins; "Nothing shared with you yet." card, ghosts, words present) |
| es-project-new | L+D | differs | design/a11y/signature: prompt still collapses to a ~110 px pill with clipped placeholder "A one-page portfolio wi" and grey send (spec 520 px card, round azure send) `v2/create/empty-project.css:18-22`; panel adds a stray "Studio site" line, search, Recent sort, Trash/Advanced foot where spec shows "0 canvases" island row |
| es-canvas-ai | L+D | differs | design: empty block is centred on the window (x≈0.50) not on the free canvas (spec x≈0.59, +132 px) `v2/empty/empty.css:365-372` (R5) |
| es-landing | L+D | match | none (dark now captures the real animation; "New artboard" is CONTRACT) |
| es-canvas-three | L+D | differs | design/copy/a11y/signature: Connect sheet still inline and clipped in the AI panel (~240 px, body cut, Cancel/Connect out of view); spec = centred 290 px card `v2/ai/NeedsYouSlot.jsx:217`; after-send cards (Drafting / Queued) not shot |
| es-artboard-new | L+D | differs | design/a11y/signature/copy: no "Empty artboard." hint card + AI chip, no inspector, Layers empty line absent; "New artboard" does not select the board (R8) `v2/empty/empty-host.jsx:125`, `editing/empty-reporter.tsx` |
| es-panels-canvas | L+D | differs | copy/design: Version history still lists "Changed this canvas · changed outside the app" instead of "Versions appear here as you work." (`history/titles.ts:247`); comments "none" carries the filter segment; confetti sparse |
| es-panels-make | L+D | differs | design/a11y: Assets has no dashed `.es-drop` frame (`left-panel/assets-panel.jsx:686-698`); Trash lacks the "Studio site" chip; Exports still "this project" (copy). Fixed since B: Exports arrow down, Trash kit block. AI-chat empty follows 03 (not a blocker) |
| es-timeline | L+D | differs | design/a11y/signature: still only "No clips on Reel yet." under a full transport bar; no ruler, drop track, Captions/Music lanes, no video inspector (`v2/timeline/timeline-empty.jsx`, `TimelineHost.jsx`) |
| es-search-k | L+D | match | none (Rounded situation line, esc key, Ask AI row, geometry close; "Did you mean" = fixture) |
| es-search-more | L+D | differs | design/copy: Start-here icons fixed; label still "New canvas…" (`actions/defs/canvas.ts:21`); Assets no-hits state is not shown (impl answers the typed query with the generic "No images or footage yet.") — cannot confirm the "Nothing called" block renders |
| es-search-panel | L+D | match | none (words, spot, Ask AI chip, foot ✓; foot position + double × are warnings; panel chrome owned by 04/11/14) |
| es-filter | L+D | differs | copy: "The one artboard here is web page." (missing article, `kinds/layers-kind-model.js:81-82`); Layers rows read raw tags div/h1/p (`canvas-shell.tsx:439-449`); layer tree still under the empty block; Clear filter is a plain link without × |
| es-viewer | L+D | unreachable | needs a view/comment-only member session (hub / workspace cell vouching a role in the lane) |
| es-arriving | L+D | differs | design/a11y/signature: no skeleton artboards ("4 artboards on their way", pulse, names+sizes), panel foot has no progress bar / progressbar role (text only), canvas stand-in paints flat v1 fill with no dot grid; `SkeletonArtboard` has no caller (`shell/viewport.jsx:203`, `v2/empty/skeleton.jsx:35`) |
| es-offline-uncached | L+D | differs | design: block centred on the window, not the free canvas (R5, `empty.css:348-354`); cloud mark inline after the name instead of right-aligned (warning) |
| es-all-trashed | L+D | unreachable | `AllTrashed` never mounts (fix-navcreate: "never mounted"); pair shows the generic "Your canvas is ready."; needs a mount on 0 artboards + trash holding them, and a lane route (sync / second person) to produce the state |
| es-edge-panels | L+D | differs | copy: "Searched 1 chats" (no singular, `empty-copy.js:212`, `ai/ChatList.jsx:430`); "team of one" Share sheet not shot (needs a cloud project) |
