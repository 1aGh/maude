# critic-d3 — 05 Empty States — V2-8.5 stage D re-check after round 3 (one critic, four lenses)

Read-only. Every id was re-shot in round 3 (INDEX "round 3", full-size-path "round 3:" lines; es-canvas-three again by p8-c3-ai). Each id judged fresh from the latest pair, light and dark. Owning-board rule: Home = 11, AI chat = 03, left-panel chrome = 04/11/14; CONTRACT over board ("New artboard", "All" tab, full empty-canvas line).
Round 3 effects seen: Undo/Redo/zoom island now present bottom-left (spec parity); Canvases panel hugs its rows; kind chips only for a mixed project; Connect sheet is now a centred modal over a veil (es-canvas-three); Assets drop frame now dashed (es-panels-make).

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| es-home-cloud | L+D | match | none (Home layout/placeholder/avatar owned by 11) |
| es-home-local | L+D | differs (cannot confirm) | the drawn "No projects on this Mac yet" + "Open project…" card is not shot (impl lists a registered Studio site row); sign-in sits bare without its island; starters differ |
| es-home-shared | L+D | match | none (stacked vs two-column = 11 wins; words, ghosts, card present) |
| es-project-new | L+D | differs | prompt still a ~110 px pill with clipped placeholder and grey send (spec 520 px card, round azure send) `v2/create/empty-project.css:18-22`; panel adds stray "Studio site" line, search, Make-a-design-system, Recent sort, Trash/Advanced foot where spec shows "0 canvases" |
| es-canvas-ai | L+D | differs | empty block centred on the window, not on the free canvas (spec +~130 px) `v2/empty/empty.css:365-372` (R5); panel still has search / chips / Trash / Advanced extras |
| es-landing | L+D | match | none (real animation frames, words/Ask AI/New artboard present) |
| es-canvas-three | L+D | differs | Connect modal now centred (fixed) but the card lacks the "Advanced · API key" row (open in fix-c3-ai: guardrail); offline frame and after-send cards (Drafting / Queued) not shot, cannot confirm |
| es-artboard-new | L+D | differs | no "Empty artboard." hint card + AI chip, no compact inspector, "New artboard" does not select the board `v2/empty/empty-host.jsx:125`, `editing/empty-reporter.tsx` |
| es-panels-canvas | L+D | differs | Version history shows a "Changed this canvas · changed outside the app" row instead of "Versions appear here as you work." (`history/titles.ts:247`; fixture may own the row, cannot confirm the empty state); Comments tab row has extra "All" segment vs Open/Mine/Resolved; panels are tall columns, not 205 px cards |
| es-panels-make | L+D | differs | Exports copy "this project" vs "Studio site"; Trash lacks the "Studio site" chip in its header (project switcher sits in the foot instead); AI-chat empty follows 03 (no blocker). Assets dashed drop frame fixed |
| es-timeline | L+D | differs | only "No clips on Reel yet." under a full transport bar; no ruler, drop track + AI chip, Captions/Music lanes, no video inspector (`v2/timeline/timeline-empty.jsx`, `TimelineHost.jsx`) |
| es-search-k | L+D | match | none ("Did you mean" row = fixture) |
| es-search-more | L+D | differs | Start-here label "New canvas…" (ellipsis, `actions/defs/canvas.ts:21`); Assets no-hits "Nothing called…" block not shot (generic empty wins) |
| es-search-panel | L+D | match | none (foot position / panel chrome owned by 04/11/14) |
| es-filter | L+D | differs | "The one artboard here is web page." (missing article, `kinds/layers-kind-model.js:81-82`); Layers rows read raw tags div/h1/p (`canvas-shell.tsx:439-449`); layer tree under the empty block; Clear filter lacks × |
| es-viewer | L+D | unreachable | needs a view/comment-only member session (hub / workspace cell vouching a role) |
| es-arriving | L+D | differs | no skeleton artboards ("4 artboards on their way", pulse), no progress bar / progressbar role in the panel foot, stand-in card instead of dotted skeletons (`shell/viewport.jsx:203`, `v2/empty/skeleton.jsx:35` has no caller) |
| es-offline-uncached | L+D | differs | block centred on the window, not the free canvas (R5, `empty.css:348-354`); status word "Local project" vs "Offline — kept on this Mac"; cloud mark inline after the name |
| es-all-trashed | L+D | unreachable | `AllTrashed` never mounts (pair shows the generic "Your canvas is ready."); needs a mount on 0 artboards with the trash holding them + a lane route (sync / second person) |
| es-edge-panels | L+D | differs | "Searched 1 chats" (no singular, `empty-copy.js:212`, `ai/ChatList.jsx:430`); "team of one" Share sheet not shot (needs a cloud project) |
