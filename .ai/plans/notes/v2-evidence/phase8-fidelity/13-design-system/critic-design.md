# design-critic — 13 Design System · phase 8 stage B (fidelity)

_2026-10-22 · board `.design/ui/v2/13 Design System.tsx` (+ `.css`, `_kit.css`, DS `maude-v2`) · pairs `13-design-system/*` (full size in `agent-a55262287b808e562/.scr/{spec,impl}/13-design-system`) · lens: layout, spacing, sizes, type, colour/tokens, material, iconography, drawn states · read-only, no server booted_

**How to read this.** The impl side is a scratch project. It holds this repo's `maude` + `maude-v2` systems, converted with `maude design ds convert`, plus four plain-code canvases. So names, counts, thumbnails, token usage and folders are **(fixture)**. A fixture difference is not a finding (sev `—`). Two systems are present but only one is in use, so the single-system and "2 in use" variants of the pinned rows cannot show. The impl lane is a browser window at 1440 × 900 with no tab strip, so the 40 px vertical offset against the spec's titled window is **(fixture)** too.

**Paths.** `C/` = `apps/studio/client/`, `S/` = `apps/studio/`, `B/` = `apps/studio/ds/board/`.

**Counting.** **RCn** = a root cause from the list below. It is counted once, on the artboard named in the root-cause table, and only referenced elsewhere. **01·RCn** = a root cause already counted in `01-create-flow/critic-design.md`; it is not counted here. **Unverified** = the state exists in code, but this lane never drove it. Unverified rows are not counted and should be re-probed in stage C.

**Blockers: 36** · Warnings: 28 · Verdict: **fix-and-retry** (`opt_out_scope` palette, nothing downgraded)

## Cross-cutting (already being fixed — named once, not counted)

- **X1 — the shell is not on the maude-v2 tokens.** Accent is indigo h268, not azure h238. The dark canvas ground is 0.165, and radii and fonts are v1. This hits every frame.
- **X2 — v1 kit buttons / selects / toasts.** Examples: "Make three directions" and "Fix to 4.5:1" are outline buttons, "Check the system" is a v1 button, and the inspector uses native selects.
- **X3 — the DS board answers 403 when `ui_kits` specimens exist.** The two showcase artboards (Desktop index / showcase) read "This specimen is not loaded". They also do not follow the board's Light / Dark.

Also referenced from 01 (counted there): **01·RC4** docked v1 inspector, **01·RC5** v1 Edit toolbar, **01·RC6** full-height Canvases column (kind-chip row, Recent ⌄, Trash / count / project foot, twisties, empty thumbs), **01·RC8** no undo · redo · zoom chip.

## Root causes (several artboards each)

| # | Root cause | Owner | Counted on |
|---|---|---|---|
| RC1 | **The Design system canvas draws the token file, not the specimen.** Each section lists raw tokens. They are grouped by file group and named by `humanize()` ("Bg 0", "Fg 1", "Palette 3"), and they come in file / alphabetical order. The CAPs (colour 60, type 14) overflow the fixed 620 px artboard, so rows are clipped and "+ N more" never shows. Missing: Brand's icons / voice / Say-not / Rules for AI, Colour's "Text on surfaces" contrast pairs, Type's role rows, Space's Layout grid, Motion's cards, and Components' variants × states grid. | `B/section-*.tsx`, `B/parts.tsx:29` | ds-board-studio |
| RC2 | **`DsBar` is drawn in CSS system colours inside the canvas iframe.** It uses `Canvas` / `CanvasText` / `Highlight`, 40 px high, radius 12, 500 13px system-ui. It has no system glyph tile, and "Review…" is a `Highlight` pill. The spec is a v2 island: `--island-bg-strong`, 44 px, a 24 px `--accent-muted` glyph tile, `.seg`, and Review… as `btn--primary`. The bar also follows the system's mode, not the app theme. It is **white in the dark app**, and the app scrim does not dim it. | `B/ds-bar.tsx:36-83`, `B/board.css:441-521` | ds-board-dark |
| RC3 | **The design-system glyph and the "Uses" door are not the kit's.** The shell icon set has no `system` glyph (4 squares + a dot), so the pinned rows use `sliders` in an accent-muted tile with `--fg-0` ink. The "Uses …" link sits under the title on every kind (tokens included), with radius-md, no glyph tile and an ↗ external icon. Spec: after the rows and a separator, a 28 px pill (`--radius-pill`) with a 20 px round `--bg-2` glyph tile, "Uses Studio site system" and a `submenu` chevron. | `C/v2/left-panel/canvases-pinned.jsx:80`, `left-panel.css:108-117`; `C/v2/ds/uses-link.jsx:39-52`; `C/v2/inspector/frame.jsx:214-217`; `C/v2/inspector/inspector.css:93-105` | ds-where-studio |
| RC4 | **The DS sheets are tighter than the kit `.k-dialog`.** This covers Update canvases, Switch, Make and Convert. Padding is `--space-4` (16), not `--space-5` (24). The radius is the island's, not `--radius-xl` (20). The title is `--type-base` (14), not `--type-md` (17). The scrim is a dark `rgb(0 0 0/.32)`, not the light `--canvas-bg` veil at 0.72. Row thumbnails are 44 × 28 blank `--bg-4` boxes, not 116 × 72 renders of the canvas (76 × 48 in the compact list) ringed where the token sits. | `C/v2/ds/review.css:9-30,108-135`; `make.css:6`; `switch.css` | ds-edit-review |
| RC5 | **The token inspector is a form, not the board's editor.** It shows a native `<input type=color>` plus an oklch text field and a "Name this colour" field, with no drawn L/C square or hue rail. The value row shows the raw `oklch(…)` when the colour has no name. Contrast is a quiet line, not the `.ds-line--ok` block. Advanced is a native `<details>` ▶. The title repeats as a section header. | `C/v2/ds/kinds/token.jsx:244-400` | ds-edit-colour |
| RC6 | **`ds make` / `draft` / `mix` / `done` never yield a Design system canvas.** The new system opens in the legacy folder view, which says "No tokens parsed from …/club/colors_and_type.css". That view has a mono "…UDE-DSN/01" heading clipped under the project pill and lays out full-bleed under the floating islands. Direction artboards, the pick bar, the filling outlines and the ready banner are all unreachable from this path, even though `B/directions.tsx` and `C/v2/ds/direction-bar.jsx` exist. | `S/ds/make.ts`, `C/v2/ds/make-host.jsx`; `C/system/system-view.jsx:175-190` | ds-make-directions |

## Per artboard

### ds-where-studio — 1 · pinned above every canvas
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC3** · pinned row glyph | `system` glyph, `--accent-text`, 22 px `--accent-muted` tile | `sliders` glyph, `--fg-0` | `canvases-pinned.jsx:80` | blocker |
| light | **RC3** · Uses door | after Fill + separator; pill 28 h, round glyph tile, chevron | under the title, radius-md bar, ↗, no glyph | `frame.jsx:214-217`, `uses-link.jsx:39-52` | blocker |
| light | single-system sub-line | "Studio site system · used by 1 project" | model writes "<name> · N canvases" (cannot show here: 2 systems) | `C/v2/ds/pinned-rows.js:96` | warning |
| light | two rows, names, thumbs, Mobile artboard, tab strip | | | — | (fixture) |
| light | 01·RC4 · RC5 · RC6 · RC8 | | | see 01 | — |
| dark | Edit toolbar washes to a light translucent pill with dim glyphs; the separator draws as a bright bar (also 01–15) | `--island-bg` dark, `--border-default` sep | light island tokens over the dark ground | `S/toolbars/toolbar-css.ts:23-46` + HUD tokens (`S/canvas-hud-tokens.gen.ts`, check X1 covers it) | blocker |

### ds-where-gator — 2 · ⌘K "design system"
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | palette size / place | `.k-pal` 580 w, top 56 | 640 w, top 12vh (108) | `C/v2/search/search.css:8`; `3-shell-maude.css:1258` | blocker |
| light | "In the Design system" group | token / style / component hits by own name ("Klubová zelená — Colour · used in 88") | absent for a system-name query | `C/v2/search/search-ds.js` | blocker |
| light | order | Design system → In the Design system → Actions (Check the system, Switch…) → Ask AI, content height | Design system → Canvases → Artboards (18 results, scrolls 480 max), Actions below the fold | `search-model.js`; `search.css:10-12` | blocker |
| light | selected row | `--accent-muted` row, icon stays `--bg-3` | `--accent-tint` row + accent-filled icon tile with white glyph | `3-shell-maude.css:1328-1352` | warning |
| light | meta | right-aligned `--type-xs` | inline after the label | `search.css:69-88` | warning |
| light | field | `--type-md` 17, `esc` kbd, no rule | `--type-lg` 20, `⌘K` kbd, accent bottom rule | `3-shell-maude.css:1270-1290` | warning |
| light | row metrics | min-h 36, `--radius-md`, 24 px icon tile | padding space-3 (≈42 h), radius-sm, 26 px tile | `3-shell-maude.css:1312-1347` | warning |
| dark | = light (+ dark toolbar wash, counted above) | | | | — |

### ds-board-studio — 3 · the Design system canvas at 100 %
Section positions and sizes match `SECS` (brand 560 × 620 at 0,0 … patterns 2256 × 440 at 0,1340): **verified**.
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | board hero | 56 px glyph tile, "Design system · <system> · used by", count line, Light·Dark, faces, 100 % | none; the template opens with `<DsBar/>` only (the count line exists nowhere) | `S/ds/design-system.tsx.tpl:15-16` | blocker |
| light | **RC1** · Brand | Logo · clear space, logo tiles, Icons row (10 × 18 px line icons), Voice, Say / not, Rules for AI | Name + logo tiles only | `B/section-brand.tsx:5-38` | blocker |
| light | Brand logo tile | rendered mark | broken `<img>` (alt text "spark.svg") + an empty tile | `B/build-model.ts:182-198`; `section-brand.tsx:20` | blocker |
| light | Colour | role groups (Surfaces, Text, Accent, Status, Brand and illustration, Links and focus) with named swatches + "Used in N"; contrast pairs row | file groups (Accent, Surfaces, Lines, Text, Focus, Palette, Presence…), "Bg 0 / Fg 1 / Palette 3"; no pairs | `B/section-colour.tsx:5-37`; `parts.tsx:142-160` | blocker |
| light | overflow | everything inside 620 px | Colour (Presence row) and Type ("Type xs") clipped at the artboard edge; "+ N more" hidden | `B/parts.tsx:29` CAP; `board.css:27-32` | blocker |
| light | Type | 8 role rows (Display 35 · Semibold … Numbers), real sentences | 4 font rows ("Hamburgefonstiv 0123") + sizes sorted 2xl, 3xl, base, lg, md, sm, xl, xs; meta in px, no weight | `B/section-type.tsx:13-17,46` | blocker |
| light | Type samples | full sentences, wrap | single line with ellipsis | `B/board.css:240-244` | warning |
| light | Space & shape | Corners XS→Round ascending, Spacing, Elevation (Flat/Resting/Floating/Sheet), Layout 12-col grid + breakpoints; `ds-k--gap` 20 px between groups | radii in alphabetical order ("Radius lg 14px", md, pill, sm, xl, xs), headers butt against the row above, no Layout block | `B/section-space.tsx` | blocker |
| light | Motion | 4 cards: drawn curve, name, ms, job | duration bars + three loose curves in two columns, raw `cubic-bezier`/`linear()` | `B/section-motion.tsx` | blocker |
| light | Components | each master: header (glyph · name · used), live component in a Variants × States grid (Default/Hover/Pressed/Focus/Disabled) + Sizes | variant / state / size **names** inline; in the capture-origin render they draw as plain text with no system component CSS. The in-app render does style them, so verify the capture path. | `B/section-components.tsx:14-90`; capture build of `@maude/ds/board` (`S/ds/ds-resolver.ts`) | blocker |
| light | Colour mode key | mini chip + "Each swatch: Light \| Dark" | text only | `B/section-colour.tsx:14-22` | warning |
| light | Patterns empty, 60 vs 22 colours, labels | | | — | (fixture) |
| light | showcase artboards | | "not loaded" | X3 | — |
| dark | = light (the board stays in system Light, as designed; ground X1) | | | | — |

### ds-board-dark — 4 · the same system in Dark
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC2** · board bar | island 44 h, glyph tile, `.seg`, view words | system-colour pill 40 h, radius 12, no glyph | `B/ds-bar.tsx:36-55`; `board.css:441-505` | blocker |
| light | project pill | "Studio site / Design system" | "Studio site / design-system" (file slug) | pill title from the canvas file | warning |
| light | sections, zoom 42 vs fit, inspector open, panel folded | | | — | (fixture) |
| light | Dark values swap on every section | ✓ | ✓ | — | verified (state) |
| dark | **RC2** · bar in the dark app | dark island | white `Canvas` bar (flips with system mode, not app theme) | `B/board.css:453-454` | blocker |

### ds-board-gator — 5 · a second system
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | structure | = ds-board-studio (RC1, RC2) | | | — |
| light | club palette, Avenir, lock glyphs, "3 projects" chip | | maude system has no locked tokens | — | (fixture) |
| dark | = light; bar dark here, white in 4-dark (RC2 inconsistency) | | | | — |

### ds-edit-colour — 6 · select a swatch, edit the colour
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | selection on the board | 2 px accent ring on the swatch | Colour **artboard** handles + "Colour 1000 × 620" tag; swatch only a faint frame | selection overlay for `[data-ds-token]` (`S/inspect.ts`) | blocker |
| light | **RC5** · picker | drawn L/C square 92 h + hue rail | native colour input + oklch text field | `kinds/token.jsx:286-317` | blocker |
| light | value row / name | "■ Deeper azure" | raw "oklch(0.53 0.175 238)" + extra "Name this colour" field | `token.jsx:268-273,318-336` | warning |
| light | contrast line | `.ds-line--ok`: `--bg-3` block, check-circle `--status-success-text`, `--fg-0` text | quiet text "✓ Light 4.8:1 · Dark 4.7:1" | `token.jsx:346-350` | warning |
| light | Advanced | chevron row, "OKLCH" right, open with mono light / dark / token rows | native `<details>` ▶, collapsed | `token.jsx:393-396` | warning |
| light | duplicated title | "Accent · Colour" once | header + "Accent" section title | `token.jsx:244-246` | warning |
| light | pending: Review… | `btn--primary` (accent fill, white), accent dot | `Highlight` pill, dark text; `Highlight` dot | `B/ds-bar.tsx:64-80`; `board.css:513-521` | blocker |
| light | "Used in 5 · was Azure · Show", Tereza presence | | no usage in fixture | — | (fixture) |
| dark | = light; bar white (RC2) | | | | — |

### ds-edit-reach — 7 · one colour, everywhere it lands
| light / dark | **Unverified.** "Show" needs a token some canvas uses, and the fixture canvases are plain code. `C/v2/ds/reach-view.jsx` exists. Stage C: re-probe on a system-styled canvas. | — |
|---|---|---|

### ds-edit-review — 8 · Update canvases, tick who follows
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC4** · sheet metrics | padding 24, `--radius-xl`, title `--type-md` 17 | padding 16, island radius, `--type-base` 14 | `review.css:13-30` | blocker |
| light | **RC4** · rows | ~80 h, 116 × 72 canvas render ringed | 46 h, 44 × 28 blank | `review.css:108-135` | blocker |
| light | backdrop | light `--canvas-bg` veil 0.72 | dark scrim 0.32 | `review.css:9` | warning |
| light | swatch pair | "■ Azure › ■ Deeper azure" | "■ › ■ Accent" (no value names) | `review-sheet.jsx:225-227` | warning |
| light | mixed tick, Landing left out, Tereza note | | | — | (fixture) |
| dark | the board bar stays bright above the scrim | dimmed with the rest | not dimmed | `B/board.css:446` z-index in iframe | warning |

### ds-edit-master — 9 · edit a master, leave a folder out
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | change preview | old → new master on the system's own ground + "Corners 2 → 6" | bold name "Button" only | `review-sheet.jsx:236-240` | blocker |
| light | folder groups / one tick per folder | | flat (no folders in fixture) | — | (fixture) |
| light | RC4 | | | | — |
| dark | = light | | | | — |

### ds-edit-instance — 10
| light / dark | **Unverified.** The fixture canvases have no component instance (a `div` was selected). `C/v2/ds/update-available.jsx` exists. | — |
|---|---|---|

### ds-truth-outside — 11 · 2 tokens changed outside the app
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | the review never surfaced (9 s, `ds status` saw the edit) | "Changed outside" flags on Quiet + Corner M, card with old → new, Undo / Keep | plain board | `C/v2/ds/truth-host.jsx`, `outside-banner.jsx`, `truth-card.jsx` | blocker |
| dark | = light | | | | — |

### ds-truth-conflict — 12
| light | same | "2 versions" flag, two Use-this cards | plain board | `truth-host.jsx`, `conflict-pick.jsx` | blocker |
|---|---|---|---|---|---|
| dark | = light | | | | — |

### ds-make-inputs — 13 · three quick inputs
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | sheet width | 640 | 560 (+ RC4 padding/title) | `make.css:6` | blocker |
| light | learn-from tiles | 4 across, 142 × 72, `--bg-3` fill, icon top, check badge top-right, ticked = `--accent-muted` | 2-col grid of 265 × 50 bordered rows, icon left | `make.css:56-100` | blocker |
| light | sentence field | `.textarea` 64 h, no grip | native textarea resize grip | `make.css:41-52` | warning |
| light | fine-print spark | coral `Spark` fill | grey ✦ | `make-sheet.jsx:230` | warning |
| light | over Home with the sentence filled and two tiles ticked; "Your canvases" tile; primary outline (disabled with an empty sentence, X2) | | | — | (fixture) |
| dark | = light | | | | — |

### ds-make-directions — 14 · three directions
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | **RC6** · state missing | 3 direction artboards (240 × 440, "Made by AI"), Preview toolbar, AI card with one question | legacy folder view "No tokens parsed" | `S/ds/make.ts`, `make-host.jsx` | blocker |
| light | legacy folder view chrome (also 29, 25) | — | mono `--accent` heading clipped under the project pill at x 130; full-bleed under the left panel / inspector; mono "TOKENS 0" | `C/system/system-view.jsx:175-190`; `styles/4-components.css .sv-*` | blocker |
| dark | = light | | | | — |

### ds-make-mix · ds-make-filling · ds-make-done — 15 · 16 · 17
| light / dark | **RC6**. The pick bar "Use A · Mix with…" with its parts menu, the dashed `--spark` section outlines with "AI is setting the type", and the ready banner "Use as Studio site's style" are all absent: impl = the folder view. Product work: `ds draft`/`done` must write or convert the system canvas, so the states are reachable without AI. | — (counted on 14) |
|---|---|---|

### ds-many-switch — 18 · preview the project in another system
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | placement | banner = top-centre island (`.ds-banner`, top `--space-4`); menu anchored under the pinned row at the panel edge | banner + menu docked bottom-centre over the toolbar slot (toolbar hidden) | `C/v2/ds/switch.css:116-126` | blocker |
| light | menu rows | systems + sep + "Open the Design system ↵ · Make a design system… · Link a team library…" | systems + hint line only | `preview-bar.jsx:59-80` | blocker |
| light | previewing row glyph | `system` | `layers` | `preview-bar.jsx:75` | warning |
| light | banner actions | Switch… (esc to stop) | Switch… + extra "Stop previewing" | `preview-bar.jsx:96-101` | warning |
| light | canvases re-style in the previewed system | | plain-code canvases don't | — | (fixture) |
| dark | = light | | | | — |

### ds-many-library · ds-many-linked — 19 · 20
| light / dark | **Unreachable.** The team-library review and the view-only linked row + "Linked from …" banner need a hub-linked library, and there is no local lane for one. `library-card.jsx` / `library-host.jsx` exist. Product work: a local (loopback hub) way to link a library. | blocker × 2 |
|---|---|---|

### ds-multi-panel — 21 · two systems pinned together
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | multi rows glyph tile | 24 px `--bg-3`, `--fg-1`, `system`; draft = outlined | RC3 tile | (RC3) | — |
| light | "Design systems · 2 in use", amber dot, draft row, selection + inspector | | 1 system in use, nothing selected | — | (fixture) |
| dark | = light | | | | — |

### ds-multi-schema — 22
| light / dark | **Unverified.** An amber dot does show on `maude-v2` in the 27 frame. Clicking it opens `upgrade-sheet.jsx`, but the lane never clicked. Only the apply step needs AI. | — |
|---|---|---|

### ds-multi-switch — 23
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | schema line | `.ds-line--ok` block | plain ✓ line | `C/v2/ds/switch-sheet.jsx` | warning |
| light | RC4 sheet metrics + blank 44 × 28 thumbs (spec 44 × 32 renders) | | | (RC4) | — |
| light | 0 of 0 ticked, no AI-restyles toggle, no preview banner, scope "Whole project" | | no canvas follows a system | — | (fixture) |
| dark | = light (+ dark toolbar wash) | | | | — |

### ds-multi-menu — 24 · a system's own menu
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | anchor + row state | menu below / right of the row (left 252); the row stays `--accent-tint` with its ⋯ visible | menu laid over the row (covers it); row not highlighted; ⋯ hidden | `C/v2/ds/system-menu.jsx`; `left-panel.css:152-172` | blocker |
| light | menu metrics | 340 w, highlighted item, ↵ on Open | ~236 w, no highlight, no key hint | `system-menu.jsx` | warning |
| dark | = light | | | | — |

### ds-multi-migrate — 25 (the sheet is the impl's 29 frame)
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | folder rows | `--bg-3` rows, chip right | 1 px bordered table rows | `C/v2/ds/convert-dialog.jsx` | warning |
| light | unconverted panel | rows lead to Convert (sheet over the board) | plain rows, no Convert affordance on the row | `canvases-pinned.jsx` | warning |
| light | 3 folders vs 2 | | | — | (fixture) |
| dark | = light | | | | — |

### ds-edge-contrast — 26
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | warning line | `.ds-line--warn`: `--bg-3` block, `problem` glyph in `--status-warn-text`, ghost accent "Lighten to 4.5:1" right | quiet text with a small fg ⚠; v1 outline button "Fix to 4.5:1" | `C/v2/ds/contrast-warning.jsx:30-45` | blocker |
| light | Role row | "Text on green — hints" | absent | `kinds/token.jsx` | warning |
| light | picker / title / Advanced | | | (RC5) | — |
| light | "Falls short in 3 canvases · Show" | | no usage | — | (fixture) |
| dark | = light | | | | — |

### ds-edge-trash — 27 · ds-edge-suggest — 28
| light / dark | **Unverified.** 27: the lane used the CLI, so the confirm sheet (`trash-token-sheet.jsx`, reached from token Advanced › Trash) was not opened. 28: the AI question needs AI. The `off-system` fill chip (`off-system.jsx`) does not need AI but was not driven. | — |
|---|---|---|

### ds-edge-migrate — 29
| light / dark | **(fixture)**. There are two folders, so impl shows 25's list. The one-folder section map exists (`convert-model.js:84-104`). The folder view under the sheet is counted on 14. | — |
|---|---|---|

### ds-advanced — 30
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Used by row | "Studio site · 5 canvases" | absent although the system has 4 canvases | `C/v2/ds/advanced.jsx:125` | blocker |
| light | Advanced fold | open: CSS \| JSON seg, mono token block, Files tree, Hand off tokens ⇧⌘H, Reveal in Finder | native `<details>` ▶, collapsed (the body exists in code) | `advanced.jsx:145-170` | warning |
| light | Version history | title "— <system>" + ⌥⌘H; avatar / file glyph / spark per author | plain title; a pencil tile for every row | `advanced.jsx:~175-195` | warning |
| light | flow card first glyph | `system` | `layers` | `advanced-model.js:34` | warning |
| light | Check button | done-circle glyph | ✓ (+ X2) | `advanced.jsx:135` | warning |
| light | Check results card | | not run | `check-card.jsx` | unverified |
| dark | = light; bar white (RC2) | | | | — |

## Verdict

```json
{
  "canvas": "13 Design System",
  "critic": "design-critic",
  "agent": "design-critic",
  "iter": 1,
  "blockers": 36,
  "warnings": 28,
  "top_blockers": [
    { "category": "ds", "line": 0, "summary": "Design system canvas draws the token file (raw names, alphabetical, clipped) not the specimen — RC1", "fix": "Rebuild B/section-*.tsx around 13's role groups, pairs, cards and the variants x states grid." },
    { "category": "ds-tokens", "line": 0, "summary": "DsBar in CSS system colours, white in the dark app, Review is a Highlight pill — RC2", "fix": "Draw the bar as a v2 island with --accent-muted tile and btn--primary." },
    { "category": "ux", "line": 0, "summary": "ds make/draft/done open the legacy folder view; directions/filling/done states unreachable — RC6", "fix": "Have the make verbs write the Design system canvas." }
  ],
  "verified_ids": [],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
