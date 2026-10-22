# design-critic — 01 Create Flow · phase 8 stage B (fidelity)

_2026-10-22 · board `.design/ui/v2/01 Create Flow.tsx` (+ `.css`, `_kit.css`/`_kit.tsx`, DS `maude-v2`) · pairs `01-create-flow/*` (full size in `agent-af49de751057c2ee5/.scr/pairs/01`) · lens: layout, spacing, sizes, type, colour/tokens, material, iconography, drawn states · read-only, no server booted_

**How to read this.** Every 01 artboard is drawn light. The "dark" spec is the host's re-theme, not a designed artboard, so dark impl is judged against the v2 dark ladder. A dark row only lists what dark adds; "= light" means the light findings hold. The impl lane is 1600 × 1000 shown at 0.9, so sizes below are divided back by 0.9.
**Paths.** `C/` = `apps/studio/client/`, `S/` = `apps/studio/`. **(fixture)** = a fixture difference, not a finding (sev `—`). **(board)** = this board disagrees with a later board, which the impl follows. That needs a ruling and is not counted. **RCn** = a root cause from the list below. It is counted once, on the artboard named in its row, and only referenced elsewhere.

**Blockers: 50** · Warnings: 37 · Verdict: **fix-and-retry** (`opt_out_scope` palette, nothing downgraded)

## Root causes (several artboards each)

| # | Root cause | Owner | Counted on |
|---|---|---|---|
| RC1 | **The shell still runs the v1 `.maude` ladder** (already being fixed). Accent is indigo h268 (`0.52 0.195 268`), not azure h238. Radii are 3/5/7/10/14, not 4/6/10/14/20. Fonts are Inter / Inter Tight, not system-ui. `--type-md` is 16, not 17. Dark `--bg-0` is 0.165, not 0.205, so dark islands lose their edge on the canvas. Home is the only surface on `.maude-v2` and it is the only one with the right azure. | `C/styles/1-tokens-maude.css:41,74-79,93-94,103,154,209-214,226-236` | cf-blank (dark) |
| RC2 | **The canvas iframe HUD tokens are generated from the v1 DS.** The source is `.design/system/maude`, not maude-v2. Selection tags, rings, the toolbar's active state and the size ghost are indigo h268. Dark `--maude-hud-accent-fg` is dark ink (`0.18`), so tags in dark read light-indigo with dark text. Chrome text is Inter. **Check whether this file is in the RC1 fix.** | `S/canvas-hud-tokens.gen.ts:1,13-27` | cf-add-artboard |
| RC3 | **v1 buttons / selects / toasts** (already being fixed). The inspector uses native `<select class="st-cp-nsel">`. The toast is the v1 card: two lines, accent left border, ×, Undo on its own line. The board's toast is a one-line pill: icon · words · Undo. | `C/inspector/artboard-knobs.jsx:244-338`, `css-knobs.jsx:707`; toast host | cf-duplicate-done |
| RC4 | **The inspector is the v1 docked `st-rpanel`.** It is a full-height aside with an "Inspector" strip and ×, crumbs, a "Uses project" accent bar, and CSS-vocab sections (Position/Rotation/Layout/Border/Effects/Type). The board draws a content-height island: name + kind chip, then Preset · Size · Fill · Corners · Clip · Export. The AI island reuses `st-rpanel`, so the two cannot share the right side as they do in cf-select-tweak. | `C/inspector/inspector-panel.jsx:604-632`; `C/v2/inspector/frame.jsx:193-215`; `C/v2/ai/AiChatIsland.jsx:89` | cf-select-tweak |
| RC5 | **The Edit toolbar is the v1 size.** Impl: 32 px buttons, 16 px glyphs, radius 14, active = indigo tint + a 2 px **underbar** (DDR-046). DS `.dock`: 40 px buttons, 18 px glyphs, `--radius-xl` 20, `--space-2` pad, active = `--accent-muted` fill, no bar. The divider also sits after Hand instead of before More. Preview's toolbar is not the 48 px FigJam size and has no colour row. | `S/toolbars/toolbar-css.ts:25,52-55,72-85`; `S/tool-palette.tsx` | cf-blank |
| RC6 | **The Canvases panel is a full-height column**, not a content-height island. It sits in `.st-sidebar` with a `border-right`. It adds rows the board does not draw: a + / folder icon row, a bordered "Search canvases… /" field (board: a `bg-3` well with "Search ⌘K"), the "Make a design system" accent row, kind chips (board), a "project · Recent ⌄" header (board: "Studio site · 6 canvases"), a twisty on every canvas row, and a Trash / count / Advanced / project-switch foot. The selected row is lavender (RC1) and not semibold. There is no "+ New canvas" row. | `C/styles/3-shell-maude.css:262-270`; `C/v2/canvases/canvases-panel.jsx:552-617,779-831`; `C/tree/tree.jsx:1395-1420` | cf-blank |
| RC7 | **The AI chat body is the v1 ACP chat.** AI replies have no bubble and carry a mono "✦ AI" label. Tool calls are mono bordered rows ("Edit the canvas"). Suggestion chips are outlined (1 px border, radius-sm) with a "Because you last asked…" line. The composer is a 54 px multi-line well with a paperclip, and its scope chip sits above it. The header adds a status dot, a pin ⧉ and a `›` hide. The panel is a fixed ~287 × 410 column. Board: 340 wide, content-height, filled `.chip`s, a one-row ask (chip · field · azure send), header `✦ title ⌄ · + · ⌄`. | `C/styles/6-acp-chat.css:649-735,1187-1260`; `C/v2/ai/Feed.jsx:94-119`; `C/v2/ai/ai.css:171-177`; `C/v2/ai/suggest-why.js:164-167`; `C/panels/chat-header.jsx:22-60` | cf-ai-done / cf-ai-drafting |
| RC8 | **There is no undo · redo · zoom chip.** The board draws it bottom-left in every Stage frame. The impl's zoom pill is `− % +` (no undo / redo) and is off by default. | `S/canvas-lib.tsx:4436-4460`; `C/v2/settings/general-section.jsx:107-113` | cf-blank |
| RC9 | **The v1 agent-activity rim still draws on AI edits.** It is a 2.5 px `hsl(210 90% 58%)` rim with a glow, a scan wave, and a mono 11 px "editing — …" badge. It appears instead of the v2 language: a spark dashed outline, a spark pill in the label row, and a quiet "Made by AI" mark. | `S/inspect.ts:558-575`; `S/artboard-activity-overlay.tsx:57-68`; `S/canvas-lib.tsx` `showActivity` | cf-ai-drafting |

## Per artboard

### cf-home-prompt — 1 · Home, one sentence
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | content column | `.k-home` 880 wide | `.home-page` min(1080px, …) | `C/home/home.css:367-374` | blocker |
| light | Recent canvases grid | `repeat(4, minmax(0,1fr))`, 4 cards fill the column | `repeat(auto-fill, minmax(160px,1fr))` → 6 tracks, 4 cards ≈178 px, right third empty | `C/home/home.css:577-580` | blocker |
| light | card meta | one line "Studio site · 2 min ago" + faces at the right | two lines: project square + name, then the time; no faces | `C/home/home-app.jsx:906-914` | blocker |
| light | Recent projects row | picture-stack cards (Studio site · Alligators) + dashed "Open project… Any folder works" | "Shared with you" ghost shelf + "Projects" list island (11 pn-shared draws the shelf; the projects row itself is still missing) | `C/home/home-app.jsx:1166-1230`; `home.css:1386-1420` | blocker |
| light | page material | Home sits on the dotted canvas (`Canvas` dots) | flat `--canvas-bg`, no dots | `C/home/home.css:14-19` | warning |
| light | section aside | "See all" ghost button | "All projects ⌄" select only (11 draws both) | `C/home/home-app.jsx:~865-885` | warning |
| light | top right | icon-btn search + ⌘K kbd island | 320 px field "Search canvases and artboards… ⌘K" | `C/home/home.css:231-239` | warning |
| light | Home pill | "Home ⌄" | no chevron | `C/home/home-app.jsx:729-732` | warning |
| light | prompt field | caret, no ring | 2 px accent focus ring round the field | `C/home/HomeAsk.jsx:117-133` | warning |
| light | starters, thumbnails, presence text | real previews, "Tereza is here" | flat colours | — | (fixture) |
| dark | = light; the ink Alligators thumb disappears on the dark island | | | — | (fixture) |

### cf-ai-drafting — 2 · AI drafts on a new canvas
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC9**: finished Desktop | label row: web glyph + "Desktop", spark "✦ Made by AI" at the right; no ring | blue 2.5 px rim + glow + tiny badge top-right | `S/inspect.ts:558-561`; `S/artboard-activity-overlay.tsx:60-68` | blocker |
| light | Tablet being drawn | 1.5 px dashed `--spark` outline, spark pill "✦ AI is drawing Tablet" in the label row, page at 0.55 opacity | nothing | ring lane `C/v2/ai/ring-relay.js` → `ArtboardRingsLayer` (no ring for this run) | blocker |
| light | next artboard ghost | dashed `--spark` / `--spark-muted` box with "✦ Mobile — next" | none (no ghost layer for a pending artboard) | — | blocker |
| light | **RC7**: AI panel header | `✦ A calm landing page ⌄ · + · ⌄` | `+`(indigo) · ● · "New chat" · ✦1 · + · ⧉ · › | `C/panels/chat-header.jsx:22-60` | blocker |
| light | tool-call row | none drawn | mono bordered "Edit the canvas" + purple dot | `C/styles/6-acp-chat.css:649-661`; `Feed.jsx:94-119` | blocker |
| light | composer while working | one row: "◆ Whole canvas · Ask AI… · send" | not visible; empty area, then Advanced | `C/v2/ai/Composer.jsx` | blocker |
| light | panel size | 340 wide, content-height (~250) | ~287 wide, fixed ~450 tall | `C/v2/ai/AiChatIsland.jsx:89` | blocker |
| light | working row words | "AI is drawing Tablet" / "Desktop done · Mobile next" (same words as the artboard tag) | "AI is working" / "Edit the canvas · 0:03" | `C/v2/ai/Working.jsx` | warning |
| light | label-row kind glyph | web glyph | grey dot | `S/canvas-lib.tsx:3101-3106` | warning |
| light | Canvases row while AI works | a spark dot at the row's end | words "AI is working" after the name | `C/v2/ai/row-slots-lane.js`; `canvases-panel.jsx` | warning |
| light | camera | 28 %, all three in view | zoomed on Desktop | camera on first draft | warning |
| light | RC5 · RC6 · RC8 | | | see RC | — |
| dark | = light + RC1 dark ladder (canvas 0.165) | | | | — |

### cf-ai-done — 3 · Done, the result toast
The impl frame is the panel-open variant. The folded-panel toast (INDEX: present, with the agent's first sentence) is not in the pair. **(fixture)**
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC7**: suggestion chips | filled `.chip` (bg-3, no border) | 1 px bordered chips + "↻ Because you last asked …" line | `C/v2/ai/ai.css:171-177`; `suggest-why.js:164` | blocker |
| light | composer | one row, chip inside the field, azure send | 54 px well, paperclip, pale send; "• Whole canvas" chip above | `C/styles/6-acp-chat.css:1187-1260` | blocker |
| light | AI reply | bubble (bg-3, radius-lg, type-base) | plain text under a mono "✦ AI" label | `C/v2/ai/Feed.jsx` | blocker |
| light | "Made by AI" × 3 in the label rows | spark mark right of each name | none. It derives from `project:action`, which the fake agent bypasses, so this is unverified | `C/v2/ai/made-by-ai.js:10-21` | warning |
| light | tiny badge in each artboard's top-right corner | none | a small pill on every artboard | source unclear (the fake agent's page or a v1 tag) | warning |
| dark | = light + RC1 | | | | — |

### cf-select-tweak — 4 · Select, the inspector arrives
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC4**: inspector shell | content-height island, head "Desktop" + "Artboard" chip | full-height aside, "Inspector" + ×, crumbs, "Uses project" bar | `C/inspector/inspector-panel.jsx:604-632` | blocker |
| light | rows | Preset · Size W/H (focused) · Fill "White 100 %" · Corners · Clip ● · Export "PNG · 2×" | Position · Rotation · Size + Fixed⌄ · Layout · Fill `rgb(255, 255, 255)` · Corners · Border · Effects · Type · Interaction. The click hit the page div, but the artboard inspector in cf-duplicate-done differs too. | `C/v2/inspector/sections/*`, `frame.jsx` | blocker |
| light | values in mono | sans, tabular | "100 %", "0°", X/Y in mono | `C/inspector/css-knobs.jsx` | blocker |
| light | raw colour text | token name "White" + swatch | `rgb(255, 255, 255)` | `C/inspector/color.js` / fill row | blocker |
| light | selection chrome | 4 corner squares, tag "▭ Desktop 1280 × 900" in azure | edge pills + corner squares + corner-radius circles + rotate handle; tag "div · 1440 × 996" in indigo | `S/use-element-resize.tsx:37-81,518` | blocker |
| light | the view makes room | the Canvases panel folds and the canvas slides left | the panel stays (folded by hand for the frame) | `C/v2/shell/inspector-follow.js` | blocker |
| light | AI panel beside the inspector | both islands on the right | the AI panel is gone (one right slot) | `C/v2/ai/AiChatIsland.jsx:89` | blocker |
| light | Clip content off | on | off | — | (fixture) |
| dark | radius circles fill black on the white artboard; tag is light indigo with dark text (RC2) | | | `S/canvas-hud-tokens.gen.ts:13-16` | warning |

### cf-sticky-comment — 5 · A sticky and a comment
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | annotate toolbar | 48 px FigJam glyphs in colour (yellow sticky, red marker tip, emoji stamp), colour row above Sticky | 32 px monochrome line glyphs, no colour row | `S/toolbars/toolbar-icons.tsx`, `toolbar-css.ts`, `tool-palette.tsx` | blocker |
| light | sticky | `--object-yellow` / `--object-green`, ±2.5° rotation, semibold text, soft drop | paler yellow, no rotation, "You · just now" footer, selection handles | `S/annotations-layer.tsx` | warning |
| light | editing chrome | none drawn | format bar (14 B I S U ≡) + "⌘Enter commits…" hint card | `S/annotations-context-toolbar.tsx`; `annotations-layer.tsx:2776` | warning |
| light | sticky context bar | none | "● ○○ +5 · Medium ⌄ · Resolve · Turn into a comment · 🔒 · 🗑" | `S/annotations-context-toolbar.tsx:1692-1701` | warning |
| light | artboard tag | none | accent "On Tablet · moves with it" | `S/annotations-layer.tsx:6020` | warning |
| light | comment | Tereza's bubble: avatar, name, time, text | your compose popover "Tablet ▾" + accent-bordered field + square send. Tereza is unreachable (no peer). | `S/comments-overlay.tsx` | warning |
| light | Preview chrome | pill + Canvases panel stay; Share cluster switch on Preview | pill + panel replaced by "Previewing … · esc to edit" (04 md-preview draws this) | `C/v2/preview/preview-bar.jsx`; `app.jsx:3024` | (board) |
| dark | = light + RC1 / RC2 | | | | — |

### cf-undo-before — 6 · AI went too far
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | RC7 (header, reply bubble, mono tool row, chips, composer) | | | see cf-ai-done | — |
| light | thread scroll | your message as a right bubble, then the reply | your bubble scrolled half out of view at the top | `C/v2/ai/Feed.jsx` (scroll anchoring) | warning |
| light | chip words, the dark hero's art | "Try it on Tablet", "Lighter dark" | agent's words | — | (fixture) |
| dark | = light | | | | — |

### cf-undo-ai — 7 · ⌘Z undoes AI too (**unreachable**)
| light / dark | ⌘Z and ⌘K › Undo do not revert the agent's edit. The fake agent writes the file outside the edit-op path, so the "↶ Undone — the dark hero by AI · Redo" pill never shows. **To reach it:** route agent writes through `project:action` / edit-op so they land in the shared undo stack (`C/v2/undo/projection.js`), then prove it with a real agent. When it lands, the toast is RC3's pill. | blocker |

### cf-blank — 8 · ⌘N, a blank canvas
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC5** Edit toolbar | dock 56 px tall, 40 px buttons, 18 px glyphs, radius 20, muted active | ~44 px, 32 px buttons, 16 px glyphs, radius 14, underbar; Shape = square (spec: overlapping shapes), Pen = nib (spec: pencil) | `S/toolbars/toolbar-css.ts:25,52-85`; `toolbar-icons.tsx` | blocker |
| light | **RC6** Canvases panel | content-height island | full-height column + extra rows | `C/styles/3-shell-maude.css:262` | blocker |
| light | **RC8** undo/zoom chip | bottom-left `↶ ↷ · 100%` | none | `S/canvas-lib.tsx:4443` | blocker |
| light | your own face in the cluster | only other people (T) | "YO" with a yellow ring | `C/v2/presence/faces.jsx` | blocker |
| light | Comments button in the cluster | none in 01 | 💬 icon button (10 may draw it) | `C/v2/shell/share-cluster.jsx:147-160` | warning |
| light | inspector corner icon | none (no selection) | sliders icon island under the cluster | `C/v2/shell/corner-icons.jsx` | warning |
| light | AI corner icon | a vermilion spark island | grey glyph | `C/v2/shell/corner-icons.jsx` | warning |
| light | Ask AI button | 28 px tall, ⌘/ at 0.72 opacity with `--space-1` gap | ≈24 px, ⌘/ tight against the word | `C/v2/empty/ask-button.jsx` | warning |
| light | row thumbnails | 28 × 20 pictures | blank squares (index may not have run in the fixture) | `C/v2/canvases/canvases-panel.jsx` | warning |
| light | "New artboard" beside Ask AI | one button | two (05 es-canvas draws two) | `C/v2/empty/empty-canvas.jsx:9` | (board) |
| dark | **RC1** dark ladder: canvas 0.165 instead of 0.205, panel and cluster edges vanish | | | `C/styles/1-tokens-maude.css:23-25` | blocker |

### cf-add-artboard — 9 · F, a new artboard
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | F opens a size picker, not draw + inspector Preset list | PresetList under the Preset field | 08's grouped picker (App · Web page · Social · Print · Video) | `C/v2/kinds/SizePicker.jsx` | (board: 08 supersedes) |
| light | ghost tag in mono | sans semibold name + regular size | `600 11px` mono "Square 1:1 1080 × 1080" | `S/editing/size-ghost.tsx:166` | blocker |
| light | **RC2** ghost / tag in indigo | azure | indigo h268 | `S/canvas-hud-tokens.gen.ts:13-17` | blocker |
| light | the drawn artboard + Preset dropdown state | "Artboard 4 1280 × 800" selected, Laptop highlighted | not captured (drag-draw not driven) | — | warning |

### cf-duplicate-width — 10 · Duplicate at another width
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | menu icon column | 16 px `--fg-2` glyph per row (spark, duplicate, web, edit, export, trash) | no icons | `S/context-menu.tsx:219-233`; `S/editing/artboard-menu.tsx` | blocker |
| light | first row on open | hover highlight on the row you point at | 2 px accent focus ring on "Ask AI about …" (programmatic focus) | `S/context-menu.tsx:238-248,376` | warning |
| light | submenu numbers | "Laptop · 1280" with the number right-aligned | "Laptop — 1280" (stage A; not open in this frame) | `S/editing/artboard-menu.tsx:23-27` | warning |
| light | what is selected | the artboard "Desktop 1440 × 900" | the page div "div · 1440 × 996" | right-click target | warning |
| light | rows: quotes, Add comment, Start a vote…, Advanced ▸, no Copy/Paste | | | 14 ed-ab-menu | (board) |

### cf-duplicate-done — 11 · The copy lands in line
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | placement | under Desktop, left edges aligned | to the right of Mobile in the same row | `S/editing/artboard-actions.ts:86-110` | blocker |
| light | measure | accent gap line + "144" pill + dashed shared-edge line | none | no landing guides | blocker |
| light | name | "Desktop — Laptop" + size in one tag | "Desktop (1280px)" + a separate "1280 × 996" pill | duplicate-at-width naming (edit-op) | blocker |
| light | **RC3** toast | one-line pill: ⧉ "Duplicated at Laptop — 1280 wide." · Undo | v1 card: 2 lines, accent left border, ×, ~360 wide | toast host | blocker |
| light | height | 800 | 996 (a hug artboard) | — | warning |
| light | artboard inspector: native selects (Width "Laptop · 1280", "Add a width…", Content "Page flow") | | | RC3 / RC4 | — |

### cf-frames-text — 12 · Frames and text in place
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | inspector title | "Calm software, made in Brno" + "Text" chip | **"h1.dc-text-editing"**: the in-place editing class leaks into the title | `C/v2/inspector/frame.jsx:207-209` (`titleOf`) | blocker |
| light | type card | Font · Size · Weight · Colour (Ink 100 %) · Align seg | Style · Font "Inherited ⌄" native · Size·weight · Line·letter "100 %" mono · 4 align buttons · Colour "Inherited" · Resizing | `C/v2/inspector/sections/*` | blocker |
| light | text editing chrome | 1 px azure editing box + caret, no handles; parent "Hero copy · frame" outline + tag; hover "Services · frame" | edge/corner handles + rotate on the text, tag "Calm software, made · 1344 × 67" | `S/use-element-resize.tsx:37-81` | blocker |
| light | Layers open with the nested tree | Layers tab | panel folded; the draft is flat | reachability (needs a nested draft) | warning |
| light | toolbar tool while typing | Text active | Select active | `S/tool-palette.tsx` | warning |

### cf-big-tree — 13 · 93 canvases in folders
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | opening the project | the last canvas (Combine-kampan) open | v1 "No canvas open — Start quick setup" placeholder | `C/shell/viewport.jsx:162-180` | blocker |
| light | Recent block | "Recent · Uniformy-2027 · 1 h ago" above the tree | none | `C/v2/canvases/canvases-panel.jsx` | blocker |
| light | Share in a local project | enabled (CONTRACT: "Share offers to move it to the cloud") | disabled pale | `C/v2/shell/share-cluster.jsx:~138` | blocker |
| light | truncated name tooltip | full name + folder path | not driven | — | warning |
| light | names, covers, 2026/combine nesting | | | — | (fixture) |
| light | kind chips (All 93 · …) | | | 08 ak-mixed-filter | (board) |

### cf-panel-search — 14 · Search inside the panel
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | result shape | the tree flattens to a list: 28 × 20 thumb, name with the match marked, a second line (folder / matching artboard); the panel shrinks to fit | tree kept, a folder chip after each name, artboard matches nested under the canvas, panel full height | `C/v2/canvases/panel-search.js`; `canvases-panel.jsx` | blocker |
| light | query / Czech accents | | | — | (fixture) |

### cf-search-k — 15 · ⌘K, canvases first
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | canvas row | 28 px picture + name + meta right-aligned | file-glyph tile (accent-filled when selected) + meta straight after the name | search rows (`C/v2/search/search.css`, `.st-palette`) | blocker |
| light | group capping | 3 canvases → Tools and settings → Ask AI, all in view | 29 canvases scroll; Tools / Ask AI below the fold | `C/v2/search/search-model.js` (no per-group cap) | blocker |
| light | width | 580 | 640 | `C/v2/search/search.css:7-9` | warning |
| light | field key | "esc" | "⌘K" | search field | warning |

### cf-open-big — 16 · 21 artboards, fit to view
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | ⌘0 fit | all 21 inside the window with margin | the last row clipped behind the toolbar (label row / hug height not in the bounds) | `S/canvas-lib.tsx:863-891` `computeFit` | blocker |
| light | kind glyph per label | glyph + name | plain names (all-digital fixture) | `S/canvas-lib.tsx:3101` | warning |
| light | ⌘\ zen state | pill folds to the mark, toolbar to one button, "Zoom to fit · 10 %" chip, top toast | not driven (panel open) | `C/v2/shell/panel-layout.js:16` | warning |

### cf-busy — 17 (**unreachable**)
| light / dark | It needs peers: presence cursors, objects in their colours, two of your AI chats running, Tereza typing in her Preview. **To reach it:** a hub-linked project with two collab clients plus two AI runs on one canvas (the e2e collab harness). | blocker |

### cf-status-words — 18 · Save status in words
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Saved / Syncing… / Offline — kept on this Mac | four words | only "Local project" is reachable. **To reach the rest:** a hub-linked project with sync availability (not route-intercepted). | `C/v2/shell/save-status.js` | blocker |
| light | local row: own face, 💬, Share colour / radius | | | see cf-blank / RC1 | — |
| light | offline leaves a local project's word unchanged | = spec | = spec | | ✓ |

### cf-render-error — 19 · A canvas that won't draw
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | card geometry and type | 460 wide, `--radius-xl` 20, 36 px icon tile (`--bg-3`, error-text), title `--type-md` 17 semibold, body sm | ~505 wide, radius ~12, 14 px inline icon, title ~14, body indented under the icon | `C/v2/code/canvas-error-card.jsx:171-200` | blocker |
| light | the verb | primary "↶ Go back to 14:05"; AI repair as a chip in the AI panel | small bordered "✦ Ask AI to fix it" button inside the card | `canvas-error-card.jsx`; `C/v2/create/render-error.jsx:70-88` | blocker |
| light | live break of an open canvas | the v2 card | v1 dev bar "⏸ build error — držím poslední funkční verzi" (Czech debug string) | `S/canvas-comment-mount.tsx:660-671` | blocker |
| light | canvas behind the card | dotted canvas + dimmed last good version + "Last good version · 6 Oct, 14:05" pill | flat grey, no dots | viewport fallback | warning |
| light | last good version (Broken has none) | | | — | (fixture) |

### cf-offline-create — 20 · A new canvas with no internet
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | spot art page label row | a kind square + a line above the page | the line only | `C/v2/empty/spot-art.jsx` | warning |
| light | "AI is back when this Mac is online." in warn text · Ask AI stays on · spot at 0.5 | ✓ | ✓ | | ✓ |
| light | Offline word / queued prompt | | not sent; local project | — | (fixture; see 18) |

---

```json
{"canvas":"01 Create Flow","critic":"design-critic","blockers":50,"warnings":37,"verified_ids":[],"opt_out_applied":"palette","ds_blockers_downgraded":0,"board_conflicts":["cf-add-artboard vs 08 size picker","cf-duplicate-width menu rows vs 14 ed-ab-menu","cf-blank New artboard vs 05","cf-sticky-comment Preview bar vs 04 md-preview","kind chips vs 08 ak-mixed-filter"]}
```
