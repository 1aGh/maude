# critic-d3 — 01 Create Flow — phase 8 stage D, after round 3 (shell c7f1a0efd; ai re-shot; modes dup-width)

One critic, four lenses. Read-only. Evidence: round-3 full-size pairs (shell pairs/01, ai pairs/01, modes pairs/01-create-flow), fix-c3-shell.md, critic-d.md, stage B reports. All 19 reachable ids were re-shot in round 3 and judged fresh; light and dark share the same structure (dark checked on cf-blank; no dark-only blocker found).

**Result: 0 of 19 match; 19 differ; 1 unreachable (cf-busy).**

## Credit (round 3)
Undo / Redo / zoom % island bottom left now drawn (B closed); Canvases panel hugs rows, no twisty at rest; "Made by AI" label under finished artboards; "AI is drawing Desktop" tag + "Made by AI" copy; done toast "Done — Desktop, Tablet and Mobile are updated." + Undo; undo toast "Undone…" not yet; render-error card present.

## Remaining blockers shared by many ids
| RC | what | owner |
|---|---|---|
| A | Canvases panel still not the board island: `+` / New folder icon row, "Make a design system" accent row, kind chips (All 11 · 0 · 3-4 · 1 · 6 — the e2e fixture is mixed, so chips appear; board draws none), "e2e-fixture · Recent" header, blank 28x20 thumbs on every row, Trash / "N canvases · ⌘K searches every project" / Advanced / project-switcher foot, Search well says "Search canvases… /" not "Search ⌘K". Board: "Studio site · N canvases", picture rows, "+ New canvas". fix-c3-shell lists header row + switcher foot as open (e2e selectors). | `canvases-panel.jsx`, `canvases.css`, `repo-switcher` |
| C | Inspector still the docked full-height v1 column (Position / Rotation / Size Fixed / Layout / Fill / Corners / Border / Effects / Type), selection is the page "Frame 1440 x 996"; not the 264 px card (Preset / Size / Fill / Corners / Clip / Export), artboard "Desktop 1280 x 900" tag never shown. | `inspector-panel.jsx`, `v2/inspector/frame.jsx` |
| D | AI on canvas: finished artboards still wear a solid vermilion rim (Desktop in cf-ai-done / cf-select-tweak / cf-duplicate-*), drafting artboard has a dashed rim + several "AI is working" micro-tags inside the page, no Mobile ghost, camera not fit-all 28 % with all three artboards. | `artboard-activity-overlay.tsx`, `made-by-ai.js` |
| E | AI panel: outlined chips + "Because you last asked…" line, extra "Same on Tablet / Same on Mobile / Undo / Keep going / What AI did" rows, composer with paperclip + "Whole canvas" chip, tall column; title "New chat". | `v2/ai/ai.css`, `suggest-why.js` |
| F | Presence cluster: own face "Y", comment icon, "Local project" where the board draws other people + "Saved" (hub-linked fixture). | `faces.jsx`, `share-cluster.jsx` |
| G | Edit toolbar smaller than the board's 40 px dock; second "New artboard" action (05 ruling); AI corner icon is a tiny glyph, no "Frame F" tooltip. | `toolbar-css.ts` |
| H | Big project opens a plain tree with no artboards of an open canvas; Share disabled. | `viewport.jsx` |

## Per artboard (light and dark alike)
| id | theme | verdict | remaining blockers |
|---|---|---|---|
| cf-home-prompt | both | differs | Home block: "Shared with you / Nothing shared" ghost shelf + "Projects" list vs board's "Recent projects" picture row + "Open project… Any folder works"; flat ground not dotted; first starter "A design system" vs board "A pricing page"; recent cards flat colour, no faces/presence; content column wider (board 11 owns Home — still not drawn as 11 draws it per fix-navcreate). |
| cf-ai-drafting | both | differs | D (dashed rim + in-page "AI is working" tags, no Mobile ghost, camera on Desktop, not 28 % fit-all), E, A, F, G. |
| cf-ai-done | both | differs | D (solid rim on Desktop, no rim-less Tablet/Mobile pair in the shot), toast reads "Done — Desktop, Tablet and Mobile are updated." with close x (board "...are on the canvas." + Undo only), E (extra Undo/Keep going/What AI did rows, chips), A, F, G. |
| cf-select-tweak | both | differs | C (full-height inspector, tag "Frame · 1440 x 996" not "Desktop 1280 x 900", handles + radius circles), D (rim), A hidden here but AI chat absent (board shows chat island with chips Make it calmer / Tighter spacing), F. |
| cf-sticky-comment | both | differs | 32 px monochrome annotate toolbar, no colour row (G); pale unrotated stickies + format bar + hint card; compose popover instead of Tereza's bubble (needs a peer); camera zoom; A, F; sticky List glyph contrast and "⌘Enter commits" hint copy not shown fixed (cannot confirm). |
| cf-undo-before | both | differs | E (chips "Same on the other artboards / A darker shade / Apply it everywhere" vs "Try it on Tablet / Lighter dark"; extra Undo/Keep going/What AI did/Same on Tablet rows), D (Made by AI labels on Desktop and Tablet only is fine; rest of the AI chrome is not), A, F, G. |
| cf-undo-ai | both | differs (cannot confirm: undo through the shared stack) | toast still "Undo: Try a dark hero" with spinner glyph + x, not "Undone — the dark hero by AI · Redo"; Desktop shows a solid vermilion rim and reads light but the chat still says Done; A, E, F, G. |
| cf-blank | both | differs | A, F, G (second "New artboard" button, no "Frame F" tooltip, AI corner icon). Undo/zoom island now matches. |
| cf-add-artboard | both | differs | size-picker popover vs inspector Preset list (08 owns kinds, not counted); drawn "Artboard 4 1280 x 800" selection with azure tag not shown; A, F, G; v1 inspector (C). |
| cf-duplicate-width | both | differs | context menu has rows Ask AI / Duplicate / Duplicate at another width / Rename / Add comment / Start a vote / Export / Advanced / Move to trash — no Copy ⌘C / Paste ⌘V, icon column not visible; submenu "Laptop — 1280 / Tablet — 834 / Mobile — 390 / Custom width…" numbers not right-aligned and not a separate stacked card; first row carries a focus fill; C (full-height inspector), D, F, G. |
| cf-duplicate-done | both | differs | copy lands right of Mobile at 1280 wide (board: under Desktop, left edges aligned, 144 gap pill, dashed shared edge); name "Desktop (1280px)" vs "Desktop — Laptop 1280 x 800"; height 996 vs 800; toast has a green tick (board neutral ⧉) and close x, sits lower-right; inspector still v1-style artboard column (Width select / Fits content / Other widths) — close to 08 but not the card; D, F, G. |
| cf-frames-text | both | differs | Type inspector column not the Font · Size · Weight · Colour · Align card; edit box has handles + size tag (board 1 px box); Layers tree not shown; camera; A, F, G. |
| cf-big-tree | both | differs | H (no open canvas with artboards), A (blank thumbs, chips All 93 · 0 · 85 · 1 · 6, no Recent block, no tooltip), F, Share disabled. |
| cf-panel-search | both | differs | tree kept with folder chip and nested matches, panel full height (board: flat result list with thumb + second line, hugging); dark mark contrast 3.74:1 (a11y, not shown fixed); A. |
| cf-search-k | both | differs | no group caps (list scrolls off 12 rows of one group; no "Tools and settings" / "Ask AI" rows in view); file glyph rows, no 28 px picture, meta glued to the name; "29 results" footer; palette 3xx px wider than board; field key "esc" ok. |
| cf-open-big | both | differs | ⌘0 leaves last row clipped; read-out "44%" not "Zoom to fit · 10 %"; panels not hidden, no "Panels hidden. Press ⌘\ to bring them back." toast; labels plain titles (no kind glyph + size); A, G. |
| cf-busy | — | unreachable | needs a hub-linked project with two collab clients (presence cursors, objects in their colours, two AI chats, Tereza in Preview) plus a `run.doing` writer for "AI is making it greener". |
| cf-status-words | both | differs | only "Local project" reachable; Saved / Syncing… / Offline — kept on this Mac need a hub-linked project with real sync availability; own face "Y" + comment icon (F); legend sentences are board-only. |
| cf-render-error | both | differs | card is the 460 px v2 card but verb is "Ask AI to fix it" (board primary "Go back to 14:05"); no dimmed last-good version, no dotted ground, no "Last good version · 6 Oct, 14:05" pill; body mentions "line 3" (technical text belongs under Show details); live break of an open canvas shows the amber bar "This canvas has an error. Showing the last version that worked." over the dock instead of the v2 card; A, F. |
| cf-offline-create | both | differs | status word "Local project" (board "Offline — kept on this Mac", needs hub link); queued prompt + chat card not exercised; second "New artboard" button; A (no floating island with the 2026 tree, no thumbs). |

```json
{"canvas":"01 Create Flow","dir":"01-create-flow","match":[],"match_one_theme":{},"differs":["cf-home-prompt","cf-ai-drafting","cf-ai-done","cf-select-tweak","cf-sticky-comment","cf-undo-before","cf-undo-ai","cf-blank","cf-add-artboard","cf-duplicate-width","cf-duplicate-done","cf-frames-text","cf-big-tree","cf-panel-search","cf-search-k","cf-open-big","cf-status-words","cf-render-error","cf-offline-create"],"unreachable":["cf-busy"]}
```
