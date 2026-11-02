# 12 Import and Assets: design-critic, stage B (V2-8.5)

Lens: layout, spacing, sizes, type (family, size, weight, leading), colour and tokens, material, iconography, and every state the board draws.
Inputs: `.design/ui/v2/12 Import and Assets.tsx` + `.css`, `_kit.css`, DS `maude-v2` (`colors_and_type.css`, `preview/_components.css`), INDEX.md, and all 38 full-size pairs (dark and light, each one read).
Read-only. No server was booted. Pixel colours were sampled from the full-size PNGs with `magick`.

**Fixture rule.** The INDEX has no literal "(fixture)" tags. I count a difference as *data* (not a finding) only when it comes from the fixture project and not from product code: plasma JPEGs instead of drawn photos, a local project (no cloud, no people), 19 photos and no video, sound, logos or generated assets, no AI or Figma provider, no network, an `<img>` artboard with no empty frames, and a `pic.png` that is 8 × 8.

Severity: **B** = blocker (visibly different from the board, or a missing state). **W** = warning (near, sub-pixel, or copy drift).

---

## Cross-board root causes (cited once, counted once, not repeated per row)

| # | root cause | spec | impl | owner | sev |
|---|---|---|---|---|---|
| R1 | The shell still resolves the **v1 `.maude` token ladder**, so accent, surfaces and fg are not maude-v2. Measured accent: spec rgb(0,119,194) dark / (0,116,195) light; impl rgb(105,143,255) dark / (58,90,215) light. Panel body: spec (28,32,35) vs impl (18,22,27) dark; (251,253,255) vs (255,255,255) light. Every accent surface on this board is affected: Share, the selected tab, the Not used chip, Place, the selection, the drop ring, Connect and Import. | `--accent: oklch(0.53 0.175 238)` / `oklch(0.54 0.165 238)` (`colors_and_type.css:48,169`) | `--accent: oklch(0.68 0.18 268)` / `oklch(0.52 0.195 268)` | `client/styles/1-tokens-maude.css:41,154`; `1-tokens-maude-v2-shell.css` is additive only (header comment, lines 3-5), so it never overrides a shell token | B |
| R2 | **`StIcon` has no `chevron` glyph.** The ladder has only `chevron-down` and `chevron-right`, so all four Assets chevrons render as an empty `<svg>`: the group-heading "›", Browse "‹ Assets", Details "‹ Assets", and the Used-in row "›". | Kit `Icon name="chevron"` (rotated) | blank | `client/shell/icons.jsx:35-36`; callers `v2/left-panel/assets-panel.jsx:766`, `v2/assets/browse-view.jsx:81`, `v2/assets/details.jsx:128`, `:244` | B |
| R3 | **Buttons are v1 `.maude .btn`**: 1px `--border-default` outline, `--radius-sm`, `--bg-2`, weight 500. A disabled primary keeps its accent border on `--bg-1`, so it reads as an enabled, focused outline button (Import, Generate, Connect). | `.btn`: border 0, `--radius-md`, `--bg-3`, h 32, `--w-semibold`; `[disabled]` = `--fg-3` on a muted fill (`_components.css:44-73`) | outlined, radius-sm; disabled primary = accent outline | `client/styles/4-components-maude.css:12-60` (`.maude .btn`, `:disabled` 43-47, `--primary` 49-52) | B |
| R4 | **Left panel island geometry.** Spec width is 248 and it stops above the bottom row. Impl is about 236 wide and runs to the window foot, so the Zoom/Undo island is not drawn bottom-left. The narrower width also makes the Tidy foot wrap (see ia-assets-tidy). | `.k-cp` width 248, `max-height: calc(100% - 68px - 72px)` (`_kit.css:215-224`) | ≈ 236 wide, full height | `v2/shell/floating-panels.css:74-78` (slot padding only; no bottom stop) + the dock width default | B |
| R5 | **Import sheet material** (Figma and brand). | `.k-dialog`: padding `--space-5`, `--radius-xl`, `--bg-2`, inset 0.5px `--island-edge`, `--shadow-lg`; width 420 (Figma 372); title `--type-md`/`--lh-md`/semibold (`_kit.css:629-646`) | padding `--space-4`, `--radius-lg`, `--bg-1`, 1px `--border-default`; width 480 | `v2/import/brand.css:13-30` (`.bi-sheet`), `:38-41` (`.bi-title`, no line height); `fi-sheet` reuses it | B |
| R6 | **The selection tag and inspector crumb print the code word "img".** The spec uses the kind word "Photo". | "Photo · 1080 × 1026" | "img · 480 × 360", "Hero › img", "img Image" | `apps/studio/editing/selection.tsx:219-221` (`crumbLabel(crumbNodeOf(el))`) | B |
| R7 | **An open inspector carries a title bar** ("Inspector ×"), and there is an extra top-right sliders island. The board's inspector islands have neither. This belongs to canvas 14 Editing; it is visible here on placed, photo-inspector and photo-steps. | no title row | `st-rp-title` "Inspector" + close | `client/inspector/inspector-panel.jsx:615-634` | W |

---

## Per artboard

### ia-drop-photos

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | A generic dashed frame is drawn round the **whole canvas viewport**. The board has none; only the target artboard lights up. | no viewport frame | `::after` fixed inset 6px, 2px dashed, radius 12, fallback `#d63b1f` | `apps/studio/use-canvas-media-drop.tsx:176-184` | B |
| both | No target ring or pill on the artboard under the pointer. The finder-drop ring exists in code but did not paint for this drag. | `.ia-dropt`: 2px accent + 6px `--accent-tint` halo, `--radius-xs`, no fill | absent | `apps/studio/editing/finder-drop.tsx:333` (listener), `:178-200` (ring) | B |
| both | Ring and pill styling once they do paint (code read): artboard ring is dashed with a 12 % fill, and the pill is centred in the ring. | ring solid, no fill; pill **above** the artboard (`bottom: 100% + space-2`), padding 2px/`--space-2`, `--type-xs` semibold, `--shadow-sm` (`12 Import and Assets.css:171-174`) | dashed + fill; pill centred, padding 6/12, `600 12px/1.3` hardcoded, `rgba` shadow, fallback `#4a7bff` | `editing/finder-drop.tsx:178-200` | B |
| both | Drag-ghost stack with the red "6" badge and the "IMG_2231.jpg + 5 more" caption. | `.ia-drag` | macOS draws its own drag image | native (not product-ownable in the webview) | not a finding |

### ia-placed

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Hover tip sits **over the tile foot** as a translucent scrim and truncates ("Matchday-… / Used in 1 c…"). The board floats it **below** the tile and never truncates. | `.ia-tile-tip`: below the tile, `--fg-0` bg, `--bg-2` text, `--radius-sm`, `--shadow-md`, nowrap (`12 css:241-242`) | over the foot, `--bg-0` 82 % scrim, ellipsis | `v2/assets/tile.jsx:94-99`, `v2/left-panel/left-panel.css:620-648` | B |
| both | "Not placed. That picture does not fit there" note; no "6 photos" group tag; no upload bars; no "Syncing…" | — | — | the fixture `<img>` artboard has no empty frames, and it is a local project | data |
| both | No "Placed 6 photos in … Undo" toast above the toolbar (the place itself failed in the fixture) | `Toast` | — | data |

### ia-more-ways (unreachable)

- The **state does not exist.** There is no "Logo cleaned up for the canvas · Details" line, no "Preparing… 62 %" in-place bar on dropped `.mov` clips, and no "3 clips · Assemble into a video" offer. A grep of `apps/studio` finds none of these strings. Product work: a prepare-in-place clip card + the assemble offer (video drop path in `use-canvas-media-drop.tsx`), the logo-sanitise notice, and ⌘V paste landing under the pointer with the "Screenshot · now" Just-added entry. **B**

### ia-assets-panel

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No **All kinds ▾** filter chip | `chip ia-ap-kinds` | only "Not used" | `v2/left-panel/assets-panel.jsx:623-635` | B |
| both | Generate ✦ and Add + sit in the **search row**. The board puts them at the right end of the chip row, and ✦ is spark-coloured. | `.ia-ap-icons` on `.ia-ap-bar`; `.ia-ap-gen { color: var(--spark-text) }` (`12 css:219-222`) | in `.lp-head-row`, neutral `st-iconbtn` | `assets-panel.jsx:581-621` | B |
| both | An extra **⌘K** keycap in the search field | not drawn (`k-find`) | `<Kbd>⌘K</Kbd>` | `assets-panel.jsx:592` | W |
| both | Search well material | `k-find` | `.lp-find` h 30, `--bg-3`, radius-sm | `left-panel.css:516-527` | W |
| both | Group heading is weaker | `.island-title` = `--type-xs` **semibold** + count with "›" | `.lp-group` `--type-xs` regular `--fg-2`; chevron blank (R2) | `left-panel.css:569-575`, `:1094-1118` | B |
| both | No library foot "247 assets · 1.4 GB" above a hairline | `CanvasesPanel foot` | none (`DescribeProgress` takes the slot) | `assets-panel.jsx:827-850` | B |
| both | Extra "From this Mac…" row under the grid, which is not in this board | — | `.lp-mac` | `assets-panel.jsx:805-818`, `left-panel.css:544-568` | W |
| both | Tile 3-up grid, gap `--space-1`, `--radius-sm`: matches (spec ≈ 76 px, impl ≈ 74 px; the INDEX's "52 px" is a measuring slip) | `.ia-grid--3` | `.lp-grid` | `left-panel.css:576-580` | W (≈2 px, from R4) |
| both | Tile hairline: spec has `inset 0 0 0 0.5px var(--k-chrome-edge)`; impl has none (`.lp-thumb` `--bg-3` only) | `12 css:230` | — | `left-panel.css:599-608` | W |
| both | Video, Sound (waveform row), Logos, Generated (spark badge) groups | drawn | absent | no such assets in the fixture | data |
| both | Toolbar: the image tool is active in the spec; select is active in impl | `tool="image"` | select | harness state | data |

### ia-assets-keys

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Tile menu is missing **Rename…**, **Copy ⌘C** and the separator before Move to trash | `Menu` items (`tsx:690-697`) | Place ↵ · Show details ⌘I · Move to trash | `v2/assets/tile-menu.jsx:17-30` | B |
| both | A selected tile shows the hover tip without hover (the tip stays on `aria-pressed`) and truncates "IMG_2231.j… / Not used" | spec selected tile: ring only (`Library selected`), no tag | tip over the foot | `left-panel.css:645-648` + the tip placement in ia-placed | W |
| both | Selected-tile ring: 2px accent, matching | `.ia-tile[data-sel]` | `.lp-tile[aria-pressed] .lp-thumb` 2px accent | `left-panel.css:598` | ok (hue per R1) |
| both | Selected artboard "MVP zápasu 1080 × 1350" and the menu not open in the frame | — | — | harness did not select an artboard | data |

### ia-assets-browse

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Browse is a **separate fixed sheet** below a still-narrow tab row. The board widens **the panel itself** to 820, with the tabs and the panel-left icon in its header row. | `GatorChrome leftStyle={{width:820}}`, one island | `.lp-browse` `position: fixed; z-index: 60` | `left-panel.css:1224-1238` | B |
| both | The sheet runs to the window foot and **covers the bottom toolbar**; only its "…" peeks out. The board stops above the toolbar row. | max-height `calc(100% - 68px - 72px)` | full height | `left-panel.css:1224-1238` + R4 | B |
| both | No **pick circles** on the tiles (empty ring, or accent with a check) | `.ia-tile-pick` 18 px (`12 css:524-525`) | none | `v2/assets/tile.jsx` (no pick element) | B |
| both | **Large/Small** pressed state is invisible: `--bg-2` on a `--bg-2` sheet | `k-seg-b[aria-pressed]`: `--bg-2` + `--shadow-sm` + inset 1px accent (`_kit.css:229`) | bg-2 + shadow-sm, no accent ring | `left-panel.css:1298-1301` | B |
| both | Sort is a **native `<select>`** with an OS chevron | `chip ia-ap-kinds` "Newest first" + kit chevron | native select | `browse-view.jsx:97-110`, `left-panel.css:1271` | B |
| both | Back "‹ Assets" chevron blank (R2) | — | — | `browse-view.jsx:81` | (R2) |
| both | Day heading weight: board semibold `island-title`, impl looks regular | `ia-br-day` | `.lp-browse-day` | `left-panel.css:1308` | W |
| both | Foot-bar copy (code read): "or drag a picture onto an artboard" vs "or drag them onto an artboard" | `tsx:742` | `browse-view.jsx:176` | | W |
| both | "6 selected · 18.4 MB · Place 6 in … ↵" foot bar; event-name grouping "Zápas vs. Panthers · 27 Sep" | drawn | bar exists in code (`browse-view.jsx:162-190`), only shows with picks; grouping by date "22 Oct" | nothing picked by the harness; no event metadata | data |

### ia-assets-find (4 columns; state 1 reachable)

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Search field with a query has **no focus or active ring** | `.k-find--on`: `--bg-2`, 3px `--accent-tint` + inset 1px accent (`_kit.css:244`) | stays a `--bg-3` well | `left-panel.css:516-527` (no `:focus-within`) | B |
| both | Result group keeps the kind name "Photos 3". The board names how it matched. | "In the name or tags 2" (then "Seen in the picture") | "Photos" | `assets-panel.jsx:747-756` (group titles under a query) | B |
| both | Result tiles show **no match label** (gradient foot with the matched name or tag), and the grid stays 3-up | `.ia-tile-match` (`12 css:239`), `.ia-grid--2` | plain tiles, 3-up | `v2/assets/tile.jsx` (no match slot); `search-marks.jsx` covers only "seen" | B |
| both | Offer card has no border, a different inset and no leading. The button is v1. | `.ia-offer2`: padding `--space-3`, inset 1px `--border-default`, `--lh-xs`, margin-top only; `.btn` on `--bg-2` + `--shadow-sm` (`12 css:532,599`) | `.lp-offer`: padding `--space-2`/`--space-3`, margin `--space-2 --space-3` (narrower than the grid), no border | `v2/assets/describe.css:6-17` | B |
| both | Offer copy matches word for word | — | — | — | ok |
| both | Columns 2-4: consent sheet, "Seen in the picture" with marks, "Connect…" variant | drawn | not reached (AI stub) | sheet + seen code exist (`describe-consent.jsx`, `search-marks.jsx`); needs an AI connection | data |

### ia-assets-tidy

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | **Not used** chip pressed is a solid accent fill. The board uses the soft accent chip. | `chip--accent` (tint bg + accent text + check) | `--accent` bg + `--accent-fg` | `left-panel.css:1082-1085` | B |
| both | Tidy foot **wraps to two lines**: "17 assets · 2.1 / MB" and "Move 17 to the / trash…" | one line each: "31 assets · 212 MB", "Move 31 to the trash…" (`.ia-foot-act`, `12 css:248`) | wraps | `left-panel.css:1183-1193` + `v2/assets/tidy.jsx:67-80` (`btn--sm`, no nowrap) + R4 width | B |
| both | "Not counted: 12 kept only by older versions, 3 AI takes from today" banner | `.ia-notcounted` | absent | `NotCountedNote` exists (`tidy.jsx:56`) and needs older versions or AI takes; the fixture has none | data |
| both | Spark-coloured ✦ and the All kinds chip in the chip row | — | — | (see ia-assets-panel) | (counted there) |

### ia-asset-details (photo column reachable)

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Header has no **"…"** overflow button | `ia-dt-hd` with `…` | back only | `v2/assets/details.jsx:120-135` (`lp-dt-hd`) | B |
| both | Back "‹" and Used-in "›" chevrons blank (R2) | — | — | `details.jsx:128,244` | (R2) |
| both | Used-in rows have **no canvas thumbnail**. The second line shows a raw artboard id in caps ("EXPORT/01 · ARTIFACT"). | `UsedRow`: `Thumb` + name + board label, min-h 34 (`12 css:268-271`) | text only, raw id | `details.jsx:229-246` (`lp-dt-use`) | B |
| light | A lone "Photo" heading with nothing under it when the picture is unused | not drawn | `kindNoun(d)` | `details.jsx:224-226` | W |
| both | Picture block: board 150 px cover crop, `--radius-md`; impl `max-height: 220` contain | `.ia-dt-pic--short` (`12 css:258`) | `.lp-dt-pic` (`left-panel.css:701-708`) | | W |
| both | Name, row grid (72 px key column), `--type-base` semibold: match | — | — | `left-panel.css:733-755` | ok |
| both | "Place in MVP zápasu ↵" vs "Place ↵"; no Added-by avatar; no "AI saw" chips; Made-by-AI, clip and sound columns | — | — | no artboard selected; local project; no AI; no such assets | data |

### ia-photo-inspector (reachable, wrong surface)

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Selecting a placed photo opens the **generic element inspector**, not the Photo card. There is no Placement seg, no 8 Look tiles, no Light/Colour sliders, no "Remove background", no Replace/Reset, no "Only this use changes / Apply to every use…", no Advanced. Cause: the Photo tab appears only for **content-addressed** names (`assets/<8 hex>.ext`). The v2 import stores human names: the impl's own Advanced shows "Stored as assets/IMG_2231.jpg". So a photo brought in through this board's import paths never gets the Photo inspector. | `k-insp` photo card (`tsx:939-952`) | Inspector › Image / Fit / Position … | `client/inspector/inspector-panel.jsx:31` (`PHOTO_ASSET_RE`), `:48-64`, `:553-562` | B |
| both | Selection tag "img · 480 × 360" sits above-left. The board has "Photo · 1080 × 1026" at the frame foot. | — | — | R6 + `editing/selection.tsx:182-196` | (R6) |
| both | Inspector title bar | — | — | R7 | (R7) |

### ia-photo-steps

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Crop step (the "4:5 · from the artboard" pill, frame-only crop handles, the Fill/Fit/**Crop** seg, "The whole photo stays — only the frame moves."), Remove background, Done and the Apply-to-every-use sheet are all unreachable, for the same cause as ia-photo-inspector | drawn | generic inspector | `inspector-panel.jsx:31,553-562`; `v2/photo/photo-section.jsx`, `apply-every-use-sheet.jsx` exist but are gated off | B |

### ia-gen-ask

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The ask is an **inline card inside the Assets panel**. The board puts it in the **AI chat island** (bottom right): left panel folded, header "✦ Gameweek 5 photo ▾", hint, suggestion chips, mode chips "Generate an image / Generate a clip", option chips "4:5 · from Gameweek 5 ▾" and "4 variants ▾", a composer with the scope chip and a round accent send button. | `GenChat` in `GatorChrome ai=` (`tsx:1005-1023`) | `section.v2-gen` in `.lp-assets` | `v2/assets/generate-ask.jsx:238-345`, mounted at `assets-panel.jsx:642-668` | B |
| both | Options are a **native `<select>`** ("4 variants") and a bordered textarea | `chip` + kit chevron; composer | native select | `generate-ask.jsx:265-280,298` | B |
| both | Precondition error in `--status-error` red ("Select an artboard first — it sets the picture's shape.") | the board never draws this; the scope chip names the artboard | red error line | `generate-ask.jsx:325` | W |
| both | Cost line "About 30 s · billed to your Google key" and the SynthID licence line | drawn | in code (`generate-ask.jsx:282-292`), hidden without a provider | | data |

### ia-gen-placed (unreachable)

- Product code exists: `v2/assets/takes-overlay.jsx`, `takes.js`, `takes.css` (four takes, ← →). It needs a generation provider (BYOK) to reach the state. Making it reachable means a provider stub, or a recorded-takes fixture in the e2e lane. Product work beyond that: none identified. **B** (state not verifiable)

### ia-figma-sheets (sheet 1) and ia-figma-sheets-connect (sheet 2)

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Sheet material and width (R5): impl ≈ 480 wide, `--radius-lg`, 1px border, padding 16 | 372 wide, `--radius-xl`, padding 24 | — | `v2/import/brand.css:13-30` | (R5) |
| both | "Figma isn't connected yet" callout has no **lock icon** | `ia-callout` + `Icon lock 14` | text + button | `v2/import/figma-sheet.jsx:271-285` | B |
| both | Action buttons are `btn--sm` outlined (Cancel and Import); disabled Import reads as an accent outline | `.btn` (32 px) + `.btn--primary.ia-off` muted | R3 | `figma-sheet.jsx` actions + R3 | (R3) |
| both | Link field shows an accent focus border. The board draws the caret only, with no ring. | `.input` | focus ring | kit focus-ring rule | W |
| connect | Connect is outlined because it is disabled (no token typed); the board shows filled azure with a token | — | — | harness typed no token | data |
| both | Copy matches word for word on both sheets | — | — | — | ok |
| — | Sheet 3 (pick frames + destination) | drawn | needs the Figma API | `frame-picker.jsx` exists | data |

### ia-figma-arrived, ia-figjam (unreachable)

- Code exists: `v2/import/figma-artboard.jsx`, `figma-summary.jsx`, `editing/figma-paste.ts`. FigJam → whiteboard: only the sheet note and `figma-model.js` mention it, with no dedicated arrival surface found. Reachability needs a Figma API stub (recorded file JSON) in the lane. The FigJam arrival ("comes in as annotations" + the summary) needs a surface confirmed or built. **B** each (state not verifiable)

### ia-brand-steps (+ -1, -2, -3)

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| all | Sheet material and width (R5) | 420, radius-xl, pad 24 | 480, radius-lg, pad 16, 1px border | `brand.css:13-30` | (R5) |
| all | Buttons `btn--sm` outlined; disabled Import is an accent outline (light, step 1) | `.btn` 32 px, filled `--bg-3`; primary filled | R3 | `v2/import/brand-sheet.jsx:355-391` | (R3) |
| step 1 | Accepted-types copy: impl says "SVG" only | "Logo · or drop another — SVG, PNG or PDF" | "SVG" / "Logo · or drop another — SVG" | `brand-sheet.jsx:233` (+ the `:44` error "use an SVG") | W (capability) |
| step 1 | Website field has an accent focus border | caret only | ring | kit input focus | W |
| step 1 | Logo chip with the checker preview vs the empty "+ Drop a logo here" well | — | — | no logo chosen in the harness | data |
| step 3 | Couldn't-read callout has no **warning-triangle icon** | `Icon warn` at the start of the callout | text only | `brand-sheet.jsx` callout (`.bi-callout`, `brand.css:141-157`) | B |
| step 2/3 | Status row: "● Couldn't read" amber dot row above the callout. In the board's step 3 the failure lives only in the callout, and the row list shows "● Read" (green) for the logo. | — | — | partly data (no logo); the extra amber row duplicates the callout | W |
| step 2 | The "Reading…" progress state (blue dot, bar, "Usually under 10 seconds…") flashed by and was not captured | — | — | no network | data |

### ia-brand (unreachable)

- `v2/import/brand-result.jsx` exists ("use it as the project's style"). Reaching it needs a readable website, or a recorded brand-read fixture. **B** (state not verifiable)

### ia-missing (unreachable)

- `asset-placeholder.tsx` has a `data-state="waiting"` hatch, and `sync/asset-state.ts` exists. "Waiting for Jonas's Mac" needs a synced project with a peer that holds the file. Making it reachable means a two-peer sync fixture, or a seeded asset-state "waiting" record. **B** (state not verifiable)

### ia-missing-gone

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The hatched Missing placeholder is **a ~16 px strip** along the top of the frame, and the frame body is blank white. The board hatches the **whole picture frame** and centres a card (warning icon, name, "Missing — no device has it", **Relink…** button). The overlay sizes itself to the broken `<img>`'s collapsed rect, so the card and Relink are clipped away. | `AbsentPic` w 480 × h 432; card `--radius-md` | `.dc-absent` positioned from `getBoundingClientRect()` of the broken img | `apps/studio/asset-placeholder.tsx:118-135` (styles), `:265-300` (frame placement); the fixture img has no explicit height, but a real broken img collapses the same way | B |
| both | No **warning icon** in the placeholder card | `Icon warn` in red | name + line only | `asset-placeholder.tsx:282-299` | B |
| both | Placeholder colours are **hardcoded oklch, not tokens** (`--dc-absent-*`), with `font: 12px/1.35 system-ui` instead of the DS UI font and type tokens | DS tokens (`--status-error`, `--accent`, `--type-xs`) | literal oklch + system-ui | `asset-placeholder.tsx:95-106,108-118` | W (the canvas iframe has no shell tokens; acceptable if mirrored by gen-tokens) |
| both | Inspector Missing box ("Added by Tereza on 1 Oct and removed …", Relink…/Replace…) not checked: the inspector was not opened. Code read: `.asset-absent` uses a 1px `--status-error` border and `--radius-sm`. | `.ia-missbox`: `--bg-3`, `--radius-md`, no border; `StatusWord error` dot + label | bordered box | `v2/assets/missing-frame.css:5-17` | W |
| both | Left panel open on Canvases (the board has it folded) | — | — | harness | data |

### ia-edges (unreachable)

- Nine separate conditions: huge file, imported twice, .psd, offline, Tereza's, a link, Figma access, no Google key, HEIC. `import-offline.js`, `import-lines.js` and `relink.js` cover some of them. Each needs its own harness condition (provider keys, a network stub, file-type fixtures). None was verifiable. **B** (state not verifiable)

### ia-advanced

| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The fold keeps its closed-state hint ("file name") on the right after it opens | the hint hides when open (`Adv open`) | hint stays | `v2/fold/advanced-fold.jsx` (via `details-advanced.jsx:45-50`) | W |
| both | Mono values break mid-word ("assets/IMG_223 / 1.jpg", `<img / src=…`) | single-line rows, `.ia-arow` grid 78px / 1fr / auto (`12 css:282`) | `overflow-wrap: anywhere` | `left-panel.css:903-909` (`.lp-dt-av`) | B |
| both | Advanced sits pinned to the panel foot with a large empty gap above it. The board's Advanced follows the content directly. | flows under Edits | `margin-top: auto` | `left-panel.css` `.lp-dt` fold placement | W |
| both | Disclosure label: the board has `--type-sm` semibold `--fg-1` with a hairline above; impl is smaller, `--type-xs` | `Adv` | `lp-dt` fold classes | `details-advanced.jsx` `CLASSES` | W |
| both | Original / Edits / Cut-out rows and the "Import the same way from Terminal" command card | drawn | in code (`details-advanced.jsx:52-73`), data-conditional | the fixture asset has no original path, edits or cut-out | data |

---

## Counts

Blockers: R1-R6 = 6. Per-artboard B rows: drop-photos 3, more-ways 1, assets-panel 4, assets-keys 1, browse 5, find 4, tidy 2, details 2, photo-inspector 1, photo-steps 1, gen-ask 2, gen-placed 1, figma 1, figma-arrived/figjam 2, brand-steps 1, brand 1, missing 1, missing-gone 2, edges 1, advanced 1. That is 37, for **43 blockers** in total.

Warnings: R7 = 1. Per-artboard W rows: assets-panel 4, keys 1, browse 2, details 2, gen-ask 1, figma 1, brand-steps 3, missing-gone 2, advanced 3. That is 19, for **20 warnings** in total.

Verified with no difference in this lens: none. R1 (v1 accent and surfaces) and R3 (v1 buttons) touch every reachable artboard in both themes.

```json
{"canvas":"12 Import and Assets","critic":"design-critic","blockers":43,"warnings":20,"verified_ids":[]}
```
