# design-critic — 15 Annotations — V2-8.5 stage B (spec vs impl)

_2026-10-22 · board `.design/ui/v2/15 Annotations.tsx` (+ `.css`, `_kit.css`) · DS `maude-v2` (CONTRACT C13/C14/C29) · pairs: full-size PNGs from `.scr/pairs/15-annotations` (spec left 1440, impl right 1440 × 900 + note strip), crops read at 2–2.5× where noted · read-only, no server booted · opt_out_scope `palette`_

Lens: layout, spacing, sizes, typography, colour/tokens, material, iconography, and every state the board draws (stickies, arrows, sections, stickers, stamps, votes, LOD, Layers).
Fixture-only rows from the INDEX are not findings: the AI-authored seed (cream paper with a coral spark edge instead of the coloured papers people write), no collaborators (no Tereza or Jonas, no faces, no presence cursors), the Czech story copy, artboard sizes, and the Recent row being empty.

## Cross-cutting (fixes already in progress — named once, not re-counted per artboard)

| # | Root cause | Where it shows here | Owner |
|---|---|---|---|
| X1 | **v1 tokens** (in progress) | Shell accent and surfaces. Annotation chrome falls back to v1 `--maude-hud-accent` `#d63b1f` (see X3) | shell token layer |
| X2 | **v1 kit** (in progress) | Layers is a docked full-height column, not a floating island. The "Undo: move 1 artboard" toast uses the v1 left-bar style (an-vs, an-ai-apply, an-visibility) | left panel shell, toast |
| X3 | **In-canvas HUD chrome** (in progress): `toolbars/toolbar-css.ts` + `ANNOT_CSS` | Annotate dock has 32 px slots, 16 px glyphs, a mono face, an accent underbar and `#d63b1f` fallbacks (spec `.k-adock`: 48 px `k-ad-b`, 22 px glyphs, tinted tile). **In dark, the dock, colour row and Marker popover stay light** (≈#e9ecf0, glyphs ≈1.5:1), where spec is the dark `bg-2` island. Snap ring, candidates, snap tag, dangling card, "belongs" outline and the resolved tick all sit on `--maude-hud-*` | `toolbar-css.ts:16-36,48-86,145-150`, `annotations-layer.tsx:670-720` |
| X4 | **Placed stickers render as a broken image** (in progress) | an-stk-drop, an-stamps, an-ai-stickers | sticker asset URL on the canvas origin |

## New root causes (this canvas)

| # | Root cause | Evidence | Owner | Hits |
|---|---|---|---|---|
| R1 | **Annotation material is not on the DS object tokens.** (a) Papers are the hard-coded `STICKY_PALETTE` pastels. Spec papers are `--object-yellow/coral/green/sky/lilac` + 5 mixes. (b) The two "front five" rows disagree: the dock colour row shows yellow · salmon · mint · blue · lavender, while the context toolbar shows the first five array slots, yellow · white · grey · salmon · peach. The spec has one set: yellow · coral · green · sky · lilac. (c) Sticky words are weight 400 in `#2a2a28` (spec `.sticky`: rounded **semibold**, type-base, `--object-ink`). Padding is 14/16 (spec space-3 = 12). Radius is 8 with a square dog-ear corner (spec radius-xs on all four corners). Resolved words are dimmed to opacity .72 (spec: full ink, the strike + tick carry it) | crops an-sticky, an-video at 100 % | `annotations-model.ts:566-578`, `annotations/ui/element-node.tsx:283-287,348`, `text-style.ts:54-57` | every artboard with a sticky |
| R2 | **Shape labels, free text, section titles and kanban column names are in mono** (`TEXT_FONT = --u-font-mono`). Spec: `--font-rounded` semibold (`.an-shp-t`, `.an-tx`, `.an-sec-t`, `.an-alabel`) | an-today crop "Hero v2", an-section crop "Tereza's feedback 2" | `annotations/ui/text-style.ts:14`, `element-node.tsx:747,821,915` | today, section, plan, ai-write |
| R3 | **Selection grammar is Figma's, not the board's.** Stickies get an 8-handle bbox; stickers get 8 handles plus a rotate knob. Spec: a sticky is a 2 px accent outline with offset 3 and no handles (`.an-st--sel`); a sticker has 4 corner squares only (`.an-sk-sel`, "Corners resize it, square") | an-sticky, an-convert, an-stk-drop | `use-annotation-resize.tsx:50-73` | sticky, convert, ai-read, stk-drop |
| R4 | **The context toolbar's composition drifts from the board.** Sticky: Resolve and Turn into a comment are word buttons, there is a trash button and no "…" more. Spec: colours · size select · list · lock · duplicate · more, with Turn into a comment in the menu. Arrow: inks come first and amber is missing (C14: ink · red · amber · green · blue). The active segment is grey-filled (spec: accent outline + accent text). The size control is bare text (spec: bg-3 select ≈130 px). The surface has radius 12, padding 5/7 and a heavy 0 8 28 .34 shadow (spec `.island.an-ctx`, 40 px) | an-sticky, an-arrow-bind, an-arrow-kinds, an-stk-drop crops | `annotations-context-toolbar.tsx:192-205,295-315,389-400,1012-1062,1685-1705` | sticky, convert, today, arrow-*, stk-drop |
| R5 | **Proposed states are built but never draw in a real run**: elbow re-route around artboards, snap ring + tag, the dangling card, the time pin, the stamp row, ballot clusters and the vote result | see per-artboard rows | `annotations/ui/{ride,arrow-cards,time-pins,stamps,vote-dots}.tsx`, `client/v2/annotations/stamp-row.jsx` | follow, arrow-bind, dangling, video, stamps, vote |
| R6 | **Evidence gaps (re-capture, not a product verdict).** an-place was captured in Edit (the spec is Preview). an-crowd sits at 37 % (LOD starts below 25 %). In an-visibility, ⇧P is unconfirmed. In an-ai-read the click selected the artboard, not the stickies. The marker stroke is outside the frame | INDEX method notes | harness | place, crowd, visibility, ai-read, marker |

## Per artboard (L+D = both themes; D-only rows are the X3 dark islands)

### an-enter
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Annotate dock size | 48 px buttons, 22 px glyphs, island ≈64 px | 32 px slots, 16 px glyphs, ≈40 px | `toolbar-css.ts:48-56` (X3) | blocker |
| L+D | Sticky slot glyph | filled note in the current paper (`k-ad-note`, −6°) on an accent-tinted tile | outline sticky glyph with an accent underbar | `tool-palette.tsx:642-675`, `toolbar-css.ts:73-86` | blocker |
| L+D | Colour row | pill (`k-ad-pop`, radius-pill), 20 px object-token swatches, "+5" as an outlined pill | radius-12 card, 22 px pastel swatches, "+5" as plain text | `tool-palette.tsx:213-249`, `toolbar-css.ts:145-150` (R1) | blocker |
| D | Dock + colour row stay light on the dark canvas; glyphs faint | `bg-2` dark island | ≈#e9ecf0 | `toolbar-css.ts:23` (X3) | blocker |
| L+D | Key letters under the glyphs (H N C M A R T E S) | `keys` (close-up) | none | `tool-palette.tsx` | warning |
| L+D | Glyph family: Comment, Shape and Section don't match the kit's | kit `AnnotateIcon` | circle bubble / square + caret / folder | `toolbars/toolbar-icons.tsx` | warning |
| L+D | The two "front five" paper sets disagree (R1b) | one set | dock ≠ context toolbar | `annotations-model.ts:566` | warning |

### an-place
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Sticky size: fixed square with empty paper under the words | auto-size 128-148 wide, grows with words | 200 × 200 default | `annotations-model.ts:600-601` | blocker |
| L+D | Sticky type (R1c) | rounded semibold, type-base, object-ink | rounded 400, `#2a2a28` | `element-node.tsx:283-287` | blocker |
| L+D | Captured in Edit, spec is Preview (R6) | Preview, full strength | Edit, quiet | harness | warning |
| L+D | Arrow weight | 2 px `--fg-1`, filled head | thin spark line (the spark colour is fixture) | `element-node.tsx:626-627` | warning |

### an-sticky
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Paper row in the context toolbar | yellow coral green sky lilac (+5 pill) | yellow white grey salmon peach (+5 plain text) | `annotations-context-toolbar.tsx` swrow, `annotations-model.ts:566` | blocker |
| L+D | Toolbar composition (R4) | colours · size · list · lock · duplicate · … | colours · size · list · Resolve · Turn into a comment · lock · trash | `annotations-context-toolbar.tsx:1685-1705` | blocker |
| L+D | Selection (R3) | 2 px accent outline, offset 3 | bbox + 8 handles | `use-annotation-resize.tsx:50-73` | blocker |
| L+D | Size control | bg-3 select ≈130 px "Medium ⌄" | bare text + chevron | `annotations-context-toolbar.tsx:389-400` | warning |
| L+D | Toolbar material | `.island` 40 px, island edge/shadow | radius 12, 0 8 28 .34 shadow | `annotations-context-toolbar.tsx:194-205` | warning |

The six close-up cells (grow, tilt, stack, ten colours, author line) are specimen illustrations; only the selected toolbar is reachable.

### an-today
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Shape label and free text in mono (R2) | rounded semibold 12 / 16-64 px | mono | `text-style.ts:14`, `element-node.tsx:747,821` | blocker |
| L+D | Shape fill/stroke | `object-sky` 70 % + `--an-ink-blue` | `#e0ebfd` / `#3b82f6` (FILL/STROKE_PALETTE) | `annotations-model.ts:491-530` | warning |
| L+D | Size menu, link/picture/media cards and group bar not in the frame | 8 cells | — | harness | warning |

### an-arrow-bind
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | No snap ring and no tag on the bound element (R5); the CSS would be on the HUD accent (X3) | 2 px accent + 6 px accent-tint ring, tag "Button · See the work" on accent | bound end dots only | `annotations/ui/arrow-cards.tsx`, `annotations-layer.tsx:686-697` | blocker |
| L+D | Arrow line | curved, 2 px | straight, thin | `annotations/ui/arrow-kinds.ts` | warning |
| L+D | Ink row is missing amber (C14) | ink · red · amber · green · blue | ink · red · green · blue +5 | `annotations-context-toolbar.tsx` swrow | warning |

### an-follow
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Arrow never re-routes: straight lines cross the neighbouring artboard (R5) | elbow around Mobile, r 12 corners, settles on `--dur-soft` | straight | `annotations/ui/ride.ts` | blocker |
| L+D | Position bubble in magenta mono, not drawn on this board (14 owns it) | none | `oklch(.55 .2 328)` 11 px mono | `editing/artboard-guides.tsx:143,160-164` | warning |

### an-rebind — unreachable
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | State does not exist: an AI rewrite of the bound button, with the arrow following or saying what it pointed at. Needs an element id that survives the JSX rewrite (Proposed) | both outcomes | — | `annotations-bindings.ts` | blocker |

### an-arrow-kinds
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Toolbar order | Straight·Curved·Elbow · head ⌄ · inks · lock | inks · thickness · segment · heads · swap · dash · lock · trash | `annotations-context-toolbar.tsx` | warning |
| L+D | Active segment | accent outline + accent text | grey fill | `annotations-context-toolbar.tsx:295-315` | warning |

### an-marker
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Popover form | one-row pill: segment · 5 inks · +4 · 3 width dots | 3-row radius-12 card, mono tabs with pen glyphs, 2 thickness bars | `tool-palette.tsx:287-375`, `toolbar-css.ts:120-160` | blocker |
| D | Popover stays light (X3) | dark island | light card | `toolbar-css.ts` | blocker |
| L+D | Widths | 3 (6/10/14 dots) | 2 (THIN 3 / THICK 6) | `annotations-model.ts:556-557` | warning |
| L+D | Drawn stroke and the "On Post 1:1 · moves with it" outline not in the frame (R6) | — | — | harness | warning |

### an-section
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Title chip | solid object-colour chip, object-ink rounded semibold sm, count xs medium | mono 12 px coloured text on a 16 % wash, count "2" | `element-node.tsx:912-928` (R2) | blocker |
| L+D | Section body almost invisible (Edit quiet) | object-grey 38 % + 1.5 px inset | ≈ transparent | `element-node.tsx` SectionView | warning |
| L+D | Fold · Ask AI toolbar and folded rows not reached | — | — | harness | warning |

### an-templates — unreachable via S
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | S arms Section; Templates never opens above the dock. The panel is mounted only via ⌘K (`openTemplates`) | 640 px island, 4 × 2 tiles + prompt | — | `client/app.jsx:3280`, S binding in `input-router.tsx` / `tool-palette.tsx` | blocker |

### an-plan
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Kanban column chips and fill (as in an-section, R2) | tinted sections, coloured chips + counts | faint mono labels, ≈ transparent columns | `element-node.tsx:912-928` | blocker |
| L+D | Cards blank, no channel colour, no stamps | colour-coded, stamps | cream blanks | `annotations/templates.ts` | warning |
| L+D | Placed over the Tablet artboard, not next to the work | beside | over | `annotations/ui/template-place.ts` | warning |

### an-stk-gallery
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Header | type-sm semibold + E kbd, no rule | ≈17 px title + × close + header rule | `stickers-gallery.css:15-20` (`st-dialog-hd`) | warning |
| L+D | Pack heading | **name** semibold fg-0 + meta xs fg-2 | one weight | `stickers-gallery.css` `.sg-ph` | warning |
| L+D | Stamps | 32 px in 40 px bg-1 discs, gap 4 | ≈40 px, touching | `stickers-gallery.css` | warning |
| L+D | Tiles | 56 px rows on bg-1, no border | larger, white with border | `stickers-gallery.css:97-98` | warning |
| L+D | Pack order: the board shows Project status first, CONTRACT C13 says FigJam first. Impl follows C13 — fix the board or the contract | — | — | `sticker-search.js:11-16` | warning |
| L+D | Anchored right of centre over the Tablet | above the dock | right | `tool-panels.css` anchor | warning |
| L+D | E not pressed in the dock while the gallery is open | E pressed | Hand pressed | `tool-palette.tsx` | warning |

### an-stk-search
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Result cells | 3-up, 76 px on bg-1, first `data-on` (accent-muted + ring) | ≈110 px, no cell, none selected | `stickers-gallery.css:102-103` | warning |
| L+D | Captions show the matched query word | each sticker's keyword (finished/done/approved/complete) | done/done/almost-done… | `stickers-gallery.jsx:~401` | warning |
| L+D | Empty state ("hotovo") not captured | card | — | harness | warning |

### an-stk-drop
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Picture broken (X4) | sticker art | broken-image icon | — | blocker |
| L+D | Sticker toolbar | ⊙ Replace… · Flip glyph · lock · duplicate icon · … | text Replace… · Flip · lock · Duplicate · trash | `annotations-context-toolbar.tsx:1012-1062` | warning |
| L+D | Selection (R3) | 4 corner squares | 8 handles + rotate | `use-annotation-resize.tsx` | warning |
| L+D | Lands mid-view, off the artboard | under the pointer | mid-view | `annotations/ui/sticker-drop.ts` | warning |

### an-stamps
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Stamp row ("Stamps" + 6 × 42 px discs + ›) never shows during a vote (R5) | above the dock | — | `client/v2/annotations/stamp-row.jsx` mount | blocker |
| L+D | Ballot marks | stamp clusters with avatars + a count bubble (`an-scl`) and a "5 stamps on Směr B" popover | a "+" disc on the artboard corner | `annotations/ui/vote-dots.tsx` | blocker |
| L+D | Vote run in Edit; spec is Preview | Preview | Edit | harness | warning |

### an-vote
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Result section ("Hlasování · Helmy" bars in `--an-ink-green`) not reached (R5) | section | — | `vote-store.js` end-vote | blocker |
| L+D | "M yours" ballot pills under the artboards | `an-vdots` | — | `vote-dots.tsx` | warning |

The vote bar layout and its −58 % offset match (`vote.css:21-28`). The Start-a-vote sheet has no spec here.

### an-vs
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Doc-style specimen; the Comments panel belongs to canvas 10. Only the leftover v1 toast is in lens (X2) | — | — | toast | warning |

### an-convert
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Entry point | first row of the sticky context menu | toolbar word button | `annotations-context-toolbar.tsx:1701` | warning |
| L+D | Converted thread "From Jonas's sticky · turned into a comment · Undo" not captured | thread | — | harness | warning |

### an-ai-read — unreachable
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Needs a signed-in AI session. The "3 stickies" scope chip, the spark dashed outline + "The hero picture" tag (`an-aiseen`) and the one-line answer card never show; the frame selected the artboard (R6) | — | — | `annotations/ui/ai-seen.tsx`, AI panel | blocker |

### an-ai-apply
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Resolved tick | 22 px `--status-success` disc at −8/−8, 2 px bg-2 ring, white tick | 18 px at −6, spark-coloured for AI | `annotations-layer.tsx:670-673`, `ai-marks.tsx:51` | blocker |
| L+D | "Made by AI" tag + summary card not reached (no AI) | — | — | AI run | blocker |
| L+D | Struck words dimmed (R1c) | full ink | opacity .72 | `element-node.tsx:286` | warning |
| L+D | Leftover v1 toast (X2) | — | left-bar toast | toast | warning |

### an-ai-stickers
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Broken picture (X4) | DONE! / FLAGGED art | broken image | — | blocker |
| L+D | AI badge | 20 px spark disc bottom-right, 2 px ring | 18 px top-right | `ai-marks.tsx:52-55` | warning |

### an-ai-write
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | AI paper | bg-2 + 2 px inset spark + glyph; "AI" always shown | `AI_PAPER #fbf8f4` (reads grey when quiet); "AI" on hover only | `ai-marks.tsx:15`, `element-node.tsx:385-420` | warning |
| L+D | Notes written as standalone mono text, not paper (R2) | sticky cards | tiny mono text | `text-style.ts:14` | warning |
| L+D | AI arrows | 2 px spark, curved/elbow | straight, thin | `arrow-kinds.ts` | warning |

### an-layers
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | No grouping under a section (title + count, indented rows), no lock-indicator row, no "Hidden by the filter…" footer | grouped | flat | `client/v2/annotations/annotation-list.jsx:172+`, `annotation-list-model.js` | blocker |
| L+D | Docked column (X2) | island, content height | full height | left panel | blocker |
| L+D | Paper swatch | 12 px paper colour | empty white square (AI paper) | `annotation-list.jsx:107` | warning |
| L+D | Count | right-aligned | inline after the title | `annotation-list.jsx:173` | warning |

### an-visibility
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | ⇧P "hidden" state + toast "Annotations hidden. Press ⇧P to bring them back · Show" not in the frame; stickies still show (R6, re-capture) | hidden | visible | `use-annotations-visibility.tsx` | blocker |
| L+D | ⌘K "resolved" commands not captured | 3 actions | — | harness | warning |

### an-dangling
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Dangling state missing (R5): no 6/5 dashed end, no dashed outline of the trashed target, no card "Pointed at … — moved to the trash · Point to…" | all three | open rings only | `annotations/ui/arrow-cards.tsx`, `.dc-annot-dg` on the HUD accent (X3) | blocker |

### an-crowd
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | LOD colour blocks, section counts and hover card unverified at 37 % (R6) | below 25 % | — | `annotations/ui/lod.tsx` | warning |

### an-video
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Time pin chip (object-ink pill, clock glyph, "0:12") and timeline sticky marks missing (R5) | pinned | unpinned | `annotations/ui/time-pins.tsx` | blocker |

At 100 % zoom the sticky material shows R1c exactly: weight 400, radius 8 with a dog-ear.

### an-print
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | "Not printed" tag | fg-0 pill, bg-2 text, radius-sm, xs medium, printer glyph, inside the note | white HUD pill with a 1 px ring, outside above the note | `time-pins.tsx:24-31` | warning |
| L+D | Bleed (dashed `--status-error`) + crop marks on print artboards absent (14 owns them) | `an-bleed`/`an-crop` | — | editing artboard chrome | warning |

### an-viewer — unreachable
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Needs a share-grant viewer session. The Hand + Comment dock and the "Stickies need Can edit · Ask to edit" strip don't exist locally | — | — | share grant + `tool-palette.tsx` `only` | blocker |

### an-figjam — unreachable
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Needs a Figma connection. The "From FigJam" section + toast with Undo never shows (the sheet is reached but is not on this board) | — | — | `annotations/figjam-into.ts` | blocker |

## Dark

Every dark pair was opened; an-enter and an-marker were also cropped. The only dark-only difference is X3: everything drawn by the canvas-iframe HUD (dock, colour row, Marker popover) stays light. The shell-owned surfaces (context toolbar, gallery, Layers, vote sheet) follow the theme. Sticky papers are the same hex in both themes, where spec dims `--object-*` in dark (R1a).

## Verdict

```json
{"canvas":"15 Annotations","critic":"design-critic","blockers":33,"warnings":50,"verified_ids":[]}
```
