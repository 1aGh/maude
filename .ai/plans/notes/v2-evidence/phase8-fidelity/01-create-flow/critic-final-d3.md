# critic-final-d3 — 01 Create Flow — phase 8 stage D3 (FINAL, merged tip 63592219a)

One critic, four lenses, read-only. Evidence: the FINAL (D3) full-size pairs (last line of full-size-path.txt), INDEX "FINAL (D3)" section, critic-final.md (D2 checklist), stage B reports, fix-c3-shell / fix-c5-panels. Light read for every id; dark read for home, drafting, done, undo-ai, blank, render-error (dark shares the light structure elsewhere; dark cannot turn a structural difference into a match).

**Result: 1 of 19 reachable ids matches (cf-home-prompt, both themes); 18 differ; 1 unreachable (cf-busy).**

## Credit since D2
Canvases panel loses the accent "Make a design system" row, the empty Trash row and the foot at rest; search well reads "Search ⌘K"; pictures on rows (fixture rows still partly black/blank); undo toast now "Undone — Try a dark hero · Redo" (action + words, v2-p8-bugs3-undo-toast-action); finished artboards show the "Made by AI" label; toast with Undo for done / duplicate; the Comments panel docks when the comment tool arms (sticky shots).

## Remaining blockers shared by many ids
| RC | what | owner |
|---|---|---|
| A | Canvases panel: kind chips row (All 11 · 2 · 1 · 1 · 7) over a mixed fixture, "e2e-fixture · 11 canvases" header, rows with black/blank thumbs (some white boxes) and eye glyphs, "New canvas" row with extra folder icon at right; board: "Studio site · N canvases", picture rows, no chips. Chips rule (fix-c3-shell: mixed project) is a kept decision, so only fixture-driven; header/thumbs remain. | `canvases-panel.jsx`, `canvases.css`, `covers.js` |
| D | AI on canvas: drafting is a dashed rim + several in-page "AI is working" micro-tags, camera 64 % on Desktop (not fit-all 28 %), no Mobile ghost; finish moment shows the whole artboard salmon-filled with a solid rim, not label-only. | `artboard-activity-overlay.tsx`, `hold-rings.tsx`, `made-by-ai.js` |
| E | AI panel: tall pinned column down the right edge (board: hugging island), outlined chips + "Because you last asked …", extra Undo / Keep going / What AI did / Same on Tablet / Same on Mobile rows, paperclip + "Whole canvas" composer, title "New chat" in drafting. | `v2/ai/ai.css`, `suggest-why.js` |
| F | Status cluster: own face "Y" + "Local project" where the board draws faces + "Saved" (local fixture; hub-linked state unreachable). | `faces.jsx`, `share-cluster.jsx` |
| G | Second "New artboard" button beside Ask AI (05 ruling, not counted alone); AI corner icon small, no "Frame F" tooltip (cf-blank shows the tooltip only in the spec). | `toolbar-css.ts` |
| H | Big project opens "No canvas open — Start quick setup" (cf-big-tree, cf-panel-search, cf-search-k). | `viewport.jsx` |
| C | Inspector: Text selection still lands on the v1-style docked full-height column (Type / Position / Size / Interaction); artboard card (Preset / Size / Fill / Corners / Clip / Export) not shown in select-tweak (selection on the heading). | `inspector-panel.jsx`, `v2/inspector/*` |

## Per artboard
| id | theme | verdict | remaining blockers |
|---|---|---|---|
| cf-home-prompt | light | match | Follows board 11 (owning board wins): Projects + Shared shelves, All projects filter, icon + ⌘K search, "A design system" starter, flat ground, 1080 column. Spark, headline, prompt card, chip, ↵ hint, starters, empty-canvas link match 01. Faces / presence / real thumbs = fixture. |
| cf-home-prompt | dark | match | same; dark thumbs of Alligators brand are fixture content |
| cf-ai-drafting | light, dark | differs | D (dashed rim, in-page tags, camera, no Mobile ghost), E (tall column, "New chat"), A, F, G |
| cf-ai-done | light, dark | differs | D (finish frame: whole artboard filled salmon + solid rim; settled frame still tinted in the second shot), toast words + Undo right (extra close x), E (tall column, extra rows), A, F, G |
| cf-select-tweak | light, dark | differs | C (selection on the heading: Type column, handles + "Calm software, made · 1344 × 65" tag; no Desktop artboard card with Preset / Size / Fill / Corners / Clip / Export), AI island with "Make it calmer / Tighter spacing" chips absent, panel not folded, F |
| cf-sticky-comment | light, dark | differs | no 28 % view of all three artboards with the sticky row; toolbar 32 px mono, no colour dots row; stickies pale and unrotated with a format bar; compose popover (no Tereza bubble: needs a peer); Comments panel now docks (credit) but fixture is the empty state; A, F |
| cf-undo-before | light, dark | differs | E (chips "Same on the other artboards / A darker shade / Apply it everywhere" vs "Try it on Tablet / Lighter dark"; extra rows), D (solid vermilion rim on the dark Desktop), toast "Done — …" lingering, A, F, G. Dark Desktop itself reads right |
| cf-undo-ai | light, dark | differs | toast now right in shape ("Undone — Try a dark hero · Redo", label from the run per decision) but Desktop is white where the board shows the light hero too — reads right; remaining: E (extra Undo / Keep going / What AI did / Same on rows, chat still says dark hero done), A, F, G. Closest to match; the tall AI column and Canvases panel decide it |
| cf-blank | light, dark | differs | A (chips, "11 canvases" header, thumbs, folder glyph on New canvas row), F, G (second "New artboard", no Frame tooltip). Empty state, island, toolbar, undo island match |
| cf-add-artboard | light, dark | differs | size picker (08 owns, not counted) covers the drawn "Artboard 4 1280 × 800" selection + azure tag; inspector Preset card not shown; stale "Duplicate…" toast under the picker; A, F, G |
| cf-duplicate-width | light, dark | differs | context menu has no Copy ⌘C / Paste ⌘V; submenu numbers not right-aligned; inspector is the v1 artboard column (Width / Height / Other widths) not the card; F, G |
| cf-duplicate-done | light, dark | differs | copy lands right of Mobile at 25 %, not under Desktop with the 144 gap pill and dashed shared edge; name "Desktop (1280px)" vs "Desktop — Laptop 1280 × 800"; height 996 vs 800; toast has green tick + close x vs neutral; inspector column not the card; A, F, G |
| cf-frames-text | light, dark | differs | Type inspector is the v1 column (Style / Font / Size · weight / Line · letter / Align / Colour / Resizing / Case / Language / Fill / Position / Size / Interaction) not Font · Size · Weight · Colour · Align card; no Layers tree open; camera 36 % on two artboards; edit box has handles; F, G |
| cf-big-tree | light, dark | differs | H (No canvas open), no Recent block, tree of one folder expanded, blank thumbs, no tooltip, Share disabled; A, F |
| cf-panel-search | light, dark | differs | tree kept with nested "Wide" group matches and the tall panel; board is a flat 3-row result list with thumb + second line and "3 results" foot; H; A |
| cf-search-k | light, dark | differs | 29-row Canvases group scrolls off, no "Tools and settings" / Ask AI rows in view; file-glyph rows with meta glued to the name, no 28 px pictures, palette wider than board; H (panel behind); A |
| cf-open-big | light, dark | differs | ⌘0 read-out "44 %" not "Zoom to fit · 10 %"; panels not hidden, no "Panels hidden. Press ⌘\ to bring them back." toast; labels plain titles (no kind glyph + size); A, G |
| cf-busy | - | unreachable | needs a hub-linked project with two collab clients (presence, two AI chats, Tereza in Preview) plus a run.doing writer; no local route |
| cf-status-words | light, dark | differs | only "Local project" reachable (face "Y"); Saved / Syncing… / Offline — kept on this Mac need a hub-linked project with real sync availability; legend is board-only |
| cf-render-error | light, dark | differs | v2 card present but verb "Ask AI to fix it" and title "Broken can't be drawn right now", no "Go back to 14:05" primary, no dimmed last-good version, no "Last good version · 6 Oct, 14:05" pill; body "stops halfway on line 3" (technical, belongs under Show details); live break shows the amber bar over the dock; A, F |
| cf-offline-create | light, dark | differs | status word "Local project" (board "Offline — kept on this Mac", needs hub link); no queued prompt + chat card; second "New artboard" button; a Comments panel opens (not in the board frame); A (tree is chips + flat fixture, board a nested 2026 tree with thumbs) |

```json
{"canvas":"01 Create Flow","dir":"01-create-flow","match":["cf-home-prompt"],"match_one_theme":{},"differs":["cf-ai-drafting","cf-ai-done","cf-select-tweak","cf-sticky-comment","cf-undo-before","cf-undo-ai","cf-blank","cf-add-artboard","cf-duplicate-width","cf-duplicate-done","cf-frames-text","cf-big-tree","cf-panel-search","cf-search-k","cf-open-big","cf-status-words","cf-render-error","cf-offline-create"],"unreachable":["cf-busy"]}
```
