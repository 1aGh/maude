# critic-final — 01 Create Flow — phase 8 stage D2 (FINAL, merged tip d3881fe41)

One critic, four lenses, read-only. Evidence: the FINAL (D2) pairs (committed JPEGs, both themes), INDEX FINAL section, stage B reports, critic-d / critic-d3, fix-c3-shell / fix-c3-ai / fix-c3-inspect / fix-c4-navpanels. Light and dark were both read for home, drafting, done, select-tweak, blank, sticky, undo-before, undo-ai, render-error; the rest share the light structure (dark cannot turn a structural difference into a match).

**Result: 1 of 19 reachable ids matches (cf-home-prompt, both themes); 18 differ; 1 unreachable (cf-busy).**

## Credit since round 3
Undo/Redo/zoom island; "+ New canvas" row (header +/folder gone), switcher in the project pill; "Made by AI" label only on finished artboards; done toast with Undo ("Done - ... are updated."); artboard click now selects the artboard card; Convert-to-absolute in Advanced; duplicate inspector is a card; ⌘K groups (Canvases / Artboards).

## Remaining blockers shared by many ids
| RC | what | owner |
|---|---|---|
| A | Canvases panel still not the board island: "Make a design system" accent row, kind chips (All 11 ... mixed fixture), "e2e-fixture · Recent" header, blank thumbs on every row, Trash / "N canvases · ⌘K searches every project" / Advanced foot; search well "Search canvases… /" not "Search ⌘K"; board: "Studio site · N canvases" + picture rows. fix-c3-shell keeps foot + search copy on purpose (rulings). | `canvases-panel.jsx`, `canvases.css` |
| D | AI on canvas: drafting shows ~70 % camera on Desktop, not fit-all 28 %; dashed rim + in-page "AI is working" micro-tags (hold rings); no Mobile ghost (fix-c3-ai: open, no producer); finished artboard in cf-ai-done / undo shots still has a solid rim in the settled frame. | `artboard-activity-overlay.tsx`, `hold-rings.tsx` |
| E | AI panel: tall pinned column (not a hugging island); outlined chips + "Because you last asked…"; extra Undo / Keep going / What AI did / Same on Tablet rows; paperclip + "Whole canvas" composer; title "New chat" in drafting. | `v2/ai/ai.css`, `suggest-why.js` |
| F | Status cluster: own face "Y" + comment icon + "Local project" where the board draws faces + "Saved" (fixture is a local project). | `faces.jsx`, `share-cluster.jsx` |
| G | Second "New artboard" button next to Ask AI (05 ruling, not counted alone); AI corner icon grey, no "Frame F" tooltip; annotate toolbar 32 px, no colour row. | `toolbar-css.ts` |
| H | Big project opens "No canvas open - Start quick setup" (no last canvas). | `viewport.jsx` |

## Per artboard
| id | theme | verdict | remaining blockers |
|---|---|---|---|
| cf-home-prompt | light | match | Follows board 11 (owning board wins): Projects + Shared shelves, "All projects", icon+⌘K search, "A design system" starter (S10.16c, board stale), flat ground (11 draws no dots), 1080 column. Spark, question, prompt card, chip, ↵ hint, starters, empty-canvas link equal to the 01 draw. Faces / presence / real thumbs = fixture. |
| cf-home-prompt | dark | match | same |
| cf-ai-drafting | light, dark | differs | D (camera, dashed rim + in-page tags, no ghost), E (tall column, "New chat"), A, F, G |
| cf-ai-done | light, dark | differs | D (settled frame: solid rim on Desktop; three artboards not shown ring-less together), toast has the right words + Undo but sits with an extra action/close, E, A, F, G |
| cf-select-tweak | light, dark | differs | selection lands on the heading text (Type card, handles, "1344 × 65" tag) not the Desktop artboard card (Preset / Size / Fill / Corners / Clip / Export); AI island with "Make it calmer / Tighter spacing" chips absent; panels do not fold; A, F |
| cf-sticky-comment | light, dark | differs | 3 frames, no 28 % view of all three artboards, no colour row on the toolbar, stickies pale / unrotated, compose popover not Tereza's bubble (needs a peer), A, F; List-glyph contrast (a11y, not shown fixed) |
| cf-undo-before | light, dark | differs | E (chips "Same on the other artboards / A darker shade" vs "Try it on Tablet / Lighter dark"; extra rows), D, A, F, G; the board's dark Desktop reads right but chrome differs |
| cf-undo-ai | light, dark | differs | toast reads "Undo: A calm landing page for Studio site…" with × (board "Undone - the dark hero by AI · Redo"); Desktop still light with Made by AI only after; the fake agent's edit is not on the shared undo stack (unreachable state); E, A, F |
| cf-blank | light, dark | differs | A (accent row, chips, header, thumbs, foot), F, G (second "New artboard", grey AI corner icon, no Frame tooltip); toolbar + undo island + empty state match |
| cf-add-artboard | light, dark | differs | size-picker popover (08 owns kinds, not counted) but the drawn "Artboard 4 1280 × 800" selection + azure tag are not shown (picker covers it, no ghost); inspector Preset list absent; A, F, G |
| cf-duplicate-width | light, dark | differs | menu: no Copy ⌘C / Paste ⌘V (no artboard clipboard), first row focus fill; submenu numbers not right-aligned; selection card is the artboard card now; F, G |
| cf-duplicate-done | light, dark | differs | copy lands right of Mobile, not under Desktop (left edges aligned, 144 gap pill, dashed shared edge); name "Desktop (1280px)" vs "Desktop - Laptop 1280 × 800"; height 996 vs 800; toast lower-right with green tick vs centred neutral; A, F, G |
| cf-frames-text | light, dark | differs | Type card is the v1-style column (Type / Position / Size / Interaction), not Font · Size · Weight · Colour · Align; Layers tree not shown; camera 58 % one artboard; editing box has handles + tag; A, F, G |
| cf-big-tree | light, dark | differs | H (No canvas open card), no Recent block, blank thumbs, no tooltip, A, F |
| cf-panel-search | light, dark | differs | tree kept with folder chip and nested matches, tall panel (board: flat hugging list with thumb + second line); dark mark 3.74:1 (a11y, not shown fixed); H; A |
| cf-search-k | light, dark | differs | groups now, but 29-row group scrolls off, no "Tools and settings" / Ask AI row in view; file glyph rows, no 28 px picture; palette wider than board; no "esc" key shown (⌘K mark) |
| cf-open-big | light, dark | differs | ⌘0 read-out "63 %" not "Zoom to fit · 10 %"; panels not hidden, no "Panels hidden. Press ⌘\ to bring them back."; labels plain titles, no kind glyph + size; A, G |
| cf-busy | - | unreachable | needs a hub-linked project with two collab clients (presence, two AI chats, Tereza in Preview) plus a `run.doing` writer; no local route |
| cf-status-words | light, dark | differs | only "Local project" reachable (face "Y", no comment-free cluster); Saved / Syncing… / Offline - kept on this Mac need a hub-linked project with real sync availability; legend is board-only |
| cf-render-error | light, dark | differs | card is the v2 460 px card but title "Broken can't be drawn right now" and verb "Ask AI to fix it" (board "Go back to 14:05" primary); no dimmed last-good version, dotted ground or "Last good version · 6 Oct, 14:05" pill; live break still shows the amber bar over the dock; A, F |
| cf-offline-create | light, dark | differs | "AI is back when this Mac is online." ok; status word "Local project" (board "Offline - kept on this Mac", needs hub link); no queued prompt + chat card; second "New artboard" button; A |

```json
{"canvas":"01 Create Flow","dir":"01-create-flow","match":["cf-home-prompt"],"match_one_theme":{},"differs":["cf-ai-drafting","cf-ai-done","cf-select-tweak","cf-sticky-comment","cf-undo-before","cf-undo-ai","cf-blank","cf-add-artboard","cf-duplicate-width","cf-duplicate-done","cf-frames-text","cf-big-tree","cf-panel-search","cf-search-k","cf-open-big","cf-status-words","cf-render-error","cf-offline-create"],"unreachable":["cf-busy"]}
```
