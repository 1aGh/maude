# signature-moment-critic — 13 Design System (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/13 Design System.tsx` · impl = release v2 client (stage-A frames, `full-size-path.txt`) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 2.7/5** · Specificity: pass (2 filler findings) · Verdict: **divergent**

The Design system canvas is real. It renders seven section artboards, the Light | Dark switch flips every specimen to the dark values, a pending edit collects in "1 change waiting · Review…", and the review sheet has the board's anatomy: swatch pair, "Fine in Light and Dark", Before/After, one tick per canvas, Cancel / Update N. What does not come through is the board's **signature layer**:

- **No hero.** The headline, the count line and the switch are missing.
- **The specimens are plainer.** The Brand section is a name and a broken logo tile. The components are bare words, not drawn buttons in a state matrix. The type rows repeat "Hamburgefonstiv 0123" and one cut-off sentence. There is no "Text on surfaces" contrast row.
- **Patterns is empty.** It says "No patterns yet" where the board shows five real screens.
- **The master-edit review has no before → after of the master.** At this size it is also a flat list.
- **The drawn colour picker is a native `<input type=color>`.**

The **make-with-AI story (14–17) does not exist in the app.** A system made by the CLI opens in the legacy folder view ("No tokens parsed…").

Dark: the board keeps its own colours (design content, theme-pinned), so every light finding repeats. One dark-only warning: the canvas toolbar renders as a washed light pill on the dark window. It shows in every dark frame of 13, 14 and 15.

Not findings (fixture / lane, per INDEX): the board names (Studio site, Alligators, Tereza, 87 canvases), the two pinned systems (`maude` + `maude-v2`), colour counts (60 vs 22), the white section paper of the `maude` system (it has no club green), the empty "Make three directions" button (it is disabled because the sentence is empty: `make-sheet.jsx:251-253`), and the two "This specimen is not loaded" showcase artboards. The last is a lane build gate the INDEX records. It is a stage-C candidate but not a signature-lens finding.

## Axis scores (IMPL)

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment per artboard | 2/5 | 1.5 | 3.0 | The board exists, but its hero, Brand, Components, Patterns and the make flow are plainer or missing |
| Brand prominence | 2/5 | 1.0 | 2.0 | Brand section = `model.label` as text + logo tiles (one broken `spark.svg`); no lockup with clear space, no icon row, no voice |
| Mock fidelity | 2/5 | 1.0 | 2.0 | Specimens as text: component samples unstyled, type filler, no contrast pairs |
| Restraint | 4/5 | 1.5 | 6.0 | Quiet and neutral; if anything under-drawn. Raw token names ("Bg 0", "Fg 2", "Palette 1") read as files, not a system |
| Negative space | 3/5 | 1.0 | 3.0 | Big empty frames (Patterns, two unloaded showcases); dense tiny type in Colour/Type |
| **Specificity gate** | **pass** | — | — | "Hamburgefonstiv 0123" ×4 font rows (`section-type.tsx:46`); one `SENTENCE` repeated for every size. Under 5 % of the board's strings |

Weighted total 16.0/30 → **2.7/5** (divergent; signature and brand both < 3).

## Per artboard (a "both" row counts once per theme)

### ds-where-studio
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Design system row pinned above the list + inspector "Uses maude-v2" link | `sysRow` + `<Uses>` | match | `client/v2/ds/pinned-rows.js`, `client/v2/ds/uses-link.jsx` | verified (element) |
| both | Two pinned rows, not one | 1 row | `maude` + `maude-v2` | fixture (two systems) | not-a-finding |
| both | Canvas rows have no thumbnails / status dot | `Thumb` per row | text rows with carets | `client/v2/canvases/canvases-panel.jsx` | warning |

### ds-where-gator — "everything findable by its own name"
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "In the Design system" group (colours, type styles, components by name) and no actions "Check the system" / "Switch canvases…". Instead, per-artboard hits "Brand artboard in design system" ×6 | 3 groups: system · in-system · actions | systems · canvases · artboards | `client/v2/ds/use-ds-search.js:14-30` feeds `client/v2/search/search-ds.js`. The tokens match by their own text only; a system-name query lists no contents | blocker |

### ds-board-studio — the signature: the Design system canvas at 100 %
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No hero: icon tile + "Design system · Studio site system · used by Studio site", count line "7 sections · 22 colours … used by 5 canvases", Light/Dark + faces + 100 % | `.ds-hero-hd` (tsx 946-958) | board starts at the sections; only the app-bar `DsBar` pill | `ds/design-system.tsx.tpl:13-16` (only `<DsBar />`), `ds/board/ds-bar.tsx:33-54` (no count line) | blocker |
| both | Brand: no logo-with-clear-space lockup, no light/dark lockups, no icon row "line, 1.5 stroke, 16 grid", no Voice ("Calm, precise, unhurried." + SAY/NOT), no "Rules for AI and code". Impl: "maude-v2" text + 4 logo tiles, one a broken `spark.svg` | Brand SECS 560 × 620 | name + tiles | `ds/board/section-brand.tsx:8-37` | blocker |
| both | Colour: no "Text on surfaces — contrast, Light \| Dark" row (Aa pairs with ratios, the red "large text only in Dark") | 4 Aa pairs | none | `ds/board/section-colour.tsx:13-30` | blocker |
| both | Colour names are file names ("Bg 0", "Fg 2", "Palette 1"), not roles ("Page", "Ink", "Coral dot"); no "Used in N canvases" line | role + usage per swatch | raw label, no usage | `ds/board/parts.tsx:98-130`. `usedWords(token.used)` is empty: no fixture canvas uses the system | warning |
| both | Type: font rows say "Hamburgefonstiv 0123", and every size repeats one sentence cut off with "…"; sizes are listed out of order (2xl, 3xl, base, lg…) | role sentences ("Calm, careful software." / "Three ways we help" / "12 € · 29 € · 79 €") | filler | `ds/board/section-type.tsx:46` (`SENTENCE`) | blocker |
| both | Components: each master is drawn as bare words ("primary secondary ghost danger hover active focus") instead of real buttons/fields in a Default · Hover · Pressed · Focus · Disabled matrix with Sizes | rendered matrix | unstyled `.ds-m-sample` text | `ds/board/section-components.tsx:15-45`. The system's classes reach the sample, but its rules do not paint on the board (cause unconfirmed: `lookOf(componentsCss…)`, `build-model.ts:303-317`) | blocker |
| both | Patterns: "No patterns yet", where the board draws five real screens (Homepage hero, Pricing, Onboarding, Mobile detail, Landing) with the components each uses | 5 screens | empty frame | `ds/board/section-patterns.tsx:6-19`. Deliberate (V2-1.6 §5.2), but the board's moment needs the following canvases drawn here | blocker |
| both | Patterns does not say "4 canvases follow it" although 4 do | — | sentence without the count | `section-patterns.tsx:7,14` (`model.canvases` 0 on the board) | warning |
| both | Two showcase artboards "This specimen is not loaded" | — | — | lane build gate (INDEX) | not-a-finding (stage-C candidate) |

### ds-board-dark
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Light \| Dark switch swaps every specimen to the dark values; bar "… colours in their dark values" | `DsBar mode="Dark"` | match | `ds/board/ds-bar.tsx:38-54`, `ds/board/state.ts` | verified (element) |
| both | Same section gaps as ds-board-studio (no hero / plain Brand / text components / empty Patterns) | — | — | as above | blocker |

### ds-board-gator
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Same section gaps | — | — | as ds-board-studio | blocker |
| both | No brand lock, no club-green section paper, no "3 projects" chip | lock + green | — | fixture (`maude` has no locked colours, no library) | not-a-finding |

### ds-edit-colour
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No drawn picker (lightness × chroma square + hue rail in the inspector). Impl has a native `<input type=color>` swatch + an OKLCH text box | `<Picker c="accent-new" …>` | OS colour well + `oklch(0.53 0.175 238)` | `client/v2/ds/kinds/token.jsx:289-297` | blocker |
| both | Editing Light/Dark seg, Dark follows switch, contrast line, Name field | — | match | `kinds/token.jsx:280-330` | verified (element) |
| both | No "Used in 5 canvases · was Azure · Show" | `Line … action="Show"` | absent | `kinds/token.jsx:361-377` renders only with `token.used`; no fixture canvas uses it | not-a-finding (fixture) |
| both | Board at fit zoom, the selected swatch is hard to find | 48 %, board fills the window | ~30 % fit | camera on select | warning |

### ds-edit-reach
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No reach lines, ringed spots or canvases brought onto the board | 2400 × 1250 diagram | board + pending only | `client/v2/ds/reach-view.jsx` exists; the Show action needs a canvas that uses the token | warning (unproven — fixture) |

### ds-edit-review
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Sheet anatomy: swatch pair, Fine in Light and Dark, head tick, Before/After, row ticks, Cancel / Update N | `Dialog` 640 | match | `client/v2/ds/review-sheet.jsx:225-285` | verified (element) |
| both | Row thumbnails are empty grey | real covers | grey | `review-sheet.jsx:114-116` (`cover` null) | warning |
| both | No left-out example row, no "Tereza's open Pricing…" | — | — | fixture / lane | not-a-finding |

### ds-edit-master — the signature: leave a whole folder out
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No before → after of the master: the board draws two real "ZAPIŠ SE" buttons with "Corners 2 → 6". Impl: the word "Button" in bold | `GButton sm` → `GButton sm nw` + change words | name only | `client/v2/ds/review-sheet.jsx:236-240` (`components.map → <b>{c}</b>`) | blocker |
| both | Flat canvas list, no folder rows with one tick each, no expandable left-out folder | by folder | flat (4 canvases) | `client/v2/ds/review-model.js:153-165`: grouping only from `FOLDER_VIEW_FROM = 12`. Correct for 4 canvases, so the moment is unproven in this lane | warning |

### ds-edit-instance
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "Update available · Corners 2 → 6 · Update / Detach" block, no quiet update dot in the list | `.ds-upd-block` | plain frame inspector | `client/v2/ds/update-available.jsx`, `update-dots.js`. The fixture Pricing is plain code, not a `@maude/ds` instance | warning (unproven — fixture) |

### ds-truth-outside · ds-truth-conflict
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (outside) | No "2 tokens changed outside the app" card, no "Changed outside" tags | card + tags | plain board after 9 s | `client/v2/ds/truth-host.jsx:14-15`: "the studio does not push `ds:outside` yet"; poll + 5 s server quiet window. **Product work:** push `ds:outside` (or re-probe ≥ 15 s) | blocker |
| both (conflict) | No "Accent changed in two places" pick, no "2 versions" tag | two cards + Use this | plain board | same host, `conflict-pick.jsx` | blocker |

### ds-make-inputs
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Sheet with the three inputs, Cancel / Make three directions | — | match | `client/v2/ds/make-sheet.jsx` | verified (element) |
| both | Learn-from tiles: 3 in a 2-column grid, no "Your canvases" tile; spec 4 in a row | 4 tiles | 3 | `make-sheet.jsx` (empty project) | warning |
| both | Primary button looks outlined | filled | disabled (sentence empty) | `make-sheet.jsx:251-253` | not-a-finding |

### ds-make-directions · ds-make-mix · ds-make-filling · ds-make-done — the signature: AI makes it on the canvas
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (directions) | No A/B/C direction artboards above the sections, no "Made by AI" on them, no AI chat question. The new system opens as the legacy folder view ("No tokens parsed from …colors_and_type.css") | 3 × 320 × 480 `ds-dir-*` | `client/system/system-view.jsx` | `ds/board/template.ts:88-100` only adds directions with `opts.directions`; `ds/board/directions.tsx` is never shown. **Product work:** `ds make`/`draft` must write `design-system.tsx` with directions and route the pinned row to it (and a non-AI path to the chat card) | blocker |
| both (mix) | No "Use A · Mix with…" bar or parts menu | `direction-bar.jsx` | — | same | blocker |
| both (filling) | No dashed outlines for later sections, no "AI is setting the type" tag, no progress + Stop | `outline.tsx` | — | same | blocker |
| both (done) | No "Studio site system is ready · Use as Studio site's style" banner, no per-section "Made by AI" | banner + tags | — | same | blocker |
| both | The folder-view heading is cut at the left ("UDE-DSN/01") and set in mono | — | — | `client/system/system-view.jsx` | warning |

### ds-many-switch
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | List of systems with "previewing" + bar "Previewing maude in maude-v2 · Switch… / Stop previewing" | — | match | `client/v2/ds/preview-bar.jsx`, `preview-mode.js` | verified (element) |
| both | Bar and list sit bottom-centre; spec has the bar top-centre and the menu anchored under the row | top bar + row menu | bottom | `preview-bar.jsx` | warning |
| both | No "Make a design system…" / "Link a team library…" rows in the list | 2 rows | — | `system-menu.jsx` / list | warning |

### ds-many-library · ds-many-linked
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Team-library review / linked view-only row | — | not reachable | needs a hub-linked library and 3 projects; `client/v2/ds/library-card.jsx` exists | unverified (lane) |

### ds-multi-panel
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Systems pinned together, one row each | — | match | `client/v2/ds/pinned-rows.js` | verified (element); draft row / amber dot = fixture |

### ds-multi-switch
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Scope tabs, per-canvas rows, "Both follow the schema" line | — | match | `client/v2/ds/switch-sheet.jsx` | verified (element) |
| both | No "AI restyles N own tokens" switch; rows have no thumbnails / kind lines | switch + thumbs | — | `switch-sheet.jsx:6-21` (AI row; signed out?) | warning |

### ds-multi-schema · ds-edge-suggest
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Schema upgrade / off-system question | — | not reachable | AI-driven; `upgrade-sheet.jsx`, `off-system.jsx` exist | unverified (lane) |

### ds-multi-menu
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The system's own menu on the row | — | match | `client/v2/ds/system-menu.jsx` | verified (element) |
| both | No Rename… | Rename… | — | `system-menu.jsx` | warning |

### ds-multi-migrate · ds-edge-migrate
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (multi) | No amber dot / Convert prompt in the panel | — | plain rows | `client/v2/ds/row-dots.js` | warning |
| both (edge) | The convert sheet lists folders with chips, not "42 pages fold into 7 sections" with a count per section | 7 section rows | 2 folder rows | `client/v2/ds/convert-dialog.jsx` (2-folder fixture; the single-folder view is unproven) | warning |

### ds-edge-contrast · ds-edge-trash · ds-advanced
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (contrast) | Warning is a small plain line with a "Fix to 4.5:1" link; spec is an amber row with a "Lighten to 4.5:1" button and "Falls short in 3 canvases · Show" | amber row | quiet line | `client/v2/ds/contrast-warning.jsx:4` | warning |
| both (trash) | The "Move … to the trash? 40 canvases switch to the closest colour" sheet is not reached from the board | sheet | history line only | `client/v2/ds/trash-token-sheet.jsx` (no UI entry found) | warning |
| both (advanced) | No single card with tokens CSS/JSON, files tree and Hand off tokens; the panel Advanced is a raw file tree | one card | split | `client/v2/ds/advanced.jsx:5` | warning |

### dark (all frames)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark | Canvas toolbar renders as a washed light pill with faded glyphs on the dark window | solid dark island | light, low contrast | `toolbars/toolbar-css.ts:23` (`--island-bg` fallback); cause unconfirmed (theme not reaching the toolbar, or a mid-morph frame) | warning |

## Root causes that hit several artboards

1. **The board's template carries no hero.** `ds/design-system.tsx.tpl` mounts only `<DsBar/>` and seven `DSSection`s, so the headline and count line never exist (board-studio, board-dark, board-gator).
2. **The sections are drawn from the files, not composed.** Brand (`section-brand.tsx`), Type (`section-type.tsx:46` filler) and Components (`section-components.tsx`, unstyled samples) each fall back to a list. The board's specimens are sentences, lockups and live controls (board-*, edit-colour, edit-review backgrounds).
3. **Patterns is empty by design** (`section-patterns.tsx`, V2-1.6 §5.2). The board's strongest row has no producer. The ⇧I picker hides Patterns while it is empty, which carries the gap into 14.
4. **The make flow has no canvas.** A CLI-made system opens in `client/system/system-view.jsx`. `template.ts` adds directions only under `opts.directions` (make-directions/mix/filling/done).
5. **Review sheets name the component instead of drawing it** (`review-sheet.jsx:236-240`). Folder grouping starts at 12 canvases (`review-model.js:154`), so the folder moment is unproven locally.
6. **Some states are reached only through push or AI.** truth-* wait on an un-pushed `ds:outside` (`truth-host.jsx:14`). schema/suggest need AI; library/linked need a hub.

## What's working (preserve)

- The Light | Dark switch is the system's own mode, never the app's. It is correct in both app themes.
- The review sheet's anatomy and words ("Fine in Light and Dark", Before/After, one tick per canvas, "Update N canvases").
- The pinned Design system row + inspector "Uses <system>" link; the preview bar "Previewing … Switch… / Stop previewing".

---

## Verdict

```json
{
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 1,
  "warnings": 1,
  "aspiration_score": 2.7,
  "axes": {
    "signature_moment": { "score": 2, "weight": 1.5 },
    "brand_prominence": { "score": 2, "weight": 1.0 },
    "mock_fidelity": { "score": 2, "weight": 1.0 },
    "restraint": { "score": 4, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [
    "ds/board/section-type.tsx:46 'Hamburgefonstiv 0123' on every font row",
    "ds/board/section-type.tsx SENTENCE repeated for every type size"
  ],
  "top_blockers": [
    { "category": "aspiration-signature_moment", "line": null, "summary": "signature_moment 2/5: board has no hero; Patterns empty; components drawn as words; make-with-AI opens the legacy folder view", "fix": "Add the hero to design-system.tsx.tpl, draw component samples with the system's CSS, fill Patterns from the canvases that follow the system, route ds make/draft to the canvas with ds-dir-* artboards." },
    { "category": "aspiration-brand_prominence", "line": null, "summary": "brand_prominence 2/5: Brand section is the name as text + logo tiles (one broken)", "fix": "Brand section draws the primary lockup with clear space, the light/dark lockups, the icon row and the voice lines from README/SKILL." },
    { "category": "aspiration-mock_fidelity", "line": null, "summary": "mock_fidelity 2/5: type filler, unstyled component samples, no contrast pairs", "fix": "Type rows use role sentences; Colour adds the Text-on-surfaces Aa pairs; review sheets render the master before -> after." }
  ],
  "opt_out_applied": "palette",
  "passed": false
}
```

```json
{"canvas":"13 Design System","critic":"signature-moment-critic","blockers":34,"warnings":39,"verified_ids":["ds-multi-panel·light"]}
```
