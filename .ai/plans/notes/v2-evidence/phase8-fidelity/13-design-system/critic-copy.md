# copy-critic — 13 Design System (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/13 Design System.tsx` · lens: every visible string vs the board and CONTRACT §3 words + §4 voice (CONTRACT wins over a stale board; the owning board wins in board conflicts) · voice POV: calm pro tool, no "we"/"I", status = what happened · what is safe · one verb_

**Method.** Spec copy read from the board source (lines 881–1663 + the helpers above). Impl copy read from the full-size impl frames (`.scr/impl/13-design-system/*.png`, every light frame viewed or OCR'd with tesseract, key frames viewed at full size), then owners grepped in `apps/studio/client` + `apps/studio/ds`. **Dark:** copy does not change with the theme. Every dark frame was OCR-diffed against its light twin (only OCR noise differed) and `ds-edit-review-dark` was viewed. So each row below is **L·D**: the finding holds in both themes. No difference shows up in dark only.

**Fixture (not findings):** the impl runs on the converted `maude` + `maude-v2` systems with plain-code canvases. So "Studio site system" → `maude-v2`, "Alligators brand system" → `maude`, Tereza / Jonas, place counts, Czech token names and "5 canvases" can't match. A second pinned row instead of one, word names → token ids (`Fg 2`, `Bg 4`) and the "Your canvases" tile on an empty project are fixture effects too.

## Per artboard (all rows L·D)

| id | difference | spec (board) | impl | owner file:line | sev |
| --- | --- | --- | --- | --- | --- |
| ds-where-studio | Default row says no canvas uses it (contradicts "a system no canvas uses is a draft", §7) | one row "Design system · Studio site system · used by 1 project" | `maude` "Default · no canvas uses it" | client/v2/ds/pinned-rows.js:8, decorateRows | warning |
| ds-where-studio | inspector kind chip | "Artboard" | "Web page" | — CONTRACT §6 [C16] wins, **not a finding** | — |
| ds-where-gator | no "In the Design system" group (colours/type/components by name) | "Klubová zelená — Colour · brand · used in 88 canvases", type style, component rows | groups "Canvases" + "Artboards" | client/v2/search/search-ds.js:36ff | blocker |
| ds-where-gator | Actions group missing | "Check the system" · "Switch canvases to another system…" | — | client/v2/search/search-ds.js | blocker |
| ds-where-gator | **R1** file slug as the canvas name; two identical rows | "Design system" / system name (§7) | "design-system Design system · maude-v2", "Brand artboard in design-system" ×2 | client/v2/search/search-model.js:339 | blocker |
| ds-where-gator | system row meta has no use count | "Design system · used by 3 projects · 7 sections" | "Design system · 7 sections" | client/v2/search/search-ds.js:36 | warning |
| ds-where-gator | **R2** v1 word in the empty inspector (Browse tool → Preview mode, §2) | — | "…or ⌘-click straight from Browse." | client/inspector/inspector-panel.jsx:688-689 | blocker |
| ds-board-studio | board hero missing | "Design system · Studio site system · used by Studio site" + "7 sections · 22 colours, each with a Light and a Dark value · … Everything here is live — select a swatch…" | only the bar "maude-v2 · Light · Dark" | apps/studio/ds/board/ds-bar.tsx | blocker |
| ds-board-studio | status line with no "what is safe / one verb" (§4) | (showcases kept as artboards, 29) | "This specimen is not loaded." on Desktop index / showcase | apps/studio/ds/board/specimen.tsx:33 (cause: INDEX build gate) | warning |
| ds-board-dark | **R1** pill names the canvas by slug | pill "Studio site / Design system" | "Studio site / design-system" | client/app.jsx:1963 `displayName(basename(activePath))` | blocker |
| ds-board-dark | bar line | "22 colours in their dark values" | "60 colours in their dark values" — pattern matches (count is fixture) | ds/board/ds-bar.tsx:54 | ok |
| ds-board-gator | R1 pill (counted above); lock tooltip "Brand colour — locked" absent (fixture: no locked colours) | | | | — |
| ds-edit-colour | colour named by its raw value; the same value shows twice | Light "Deeper azure", Dark "Follows Light"; OKLCH only under Advanced | Light "oklch(0.53 0.175 238)" + a "Light value" field + "Name: Name this colour" | client/v2/ds/kinds/token.jsx:278,286,323 | warning |
| ds-edit-colour | contrast line doesn't name the surface | "5.6:1 on white · 4.8:1 on the dark page" | "✓ Light 4.8:1 · Dark 4.7:1" | client/v2/ds/contrast.js `contrastLine` | warning |
| ds-edit-colour | used line hidden when the count is unknown | "Used in 5 canvases · was Azure · Show" | — (`usedWords(null)` → nothing; fixture canvases follow no system) | client/v2/ds/kinds/token.jsx:364-377 | warning |
| ds-edit-colour | header then the same section title again | "Accent · Colour" | "Accent · Colour" then section "Accent" | client/v2/ds/kinds/token.jsx | warning |
| ds-edit-reach | reach view unreachable (no Show without a using canvas) | "One colour, everywhere it lands", tags "4 patterns · 21 places", "14 places", review "Update 4 canvases" | inspector only ("4.36:1 on Accent fg in Dark · Darken to 4.5:1") | client/v2/ds/reach-view.jsx; needs canvases that follow the system | blocker |
| ds-edit-review | swatch line drops the old → new names | "Azure › Deeper azure · Fine in Light and Dark" | "■ › ■ Accent · ✓ Fine in Light and Dark" | client/v2/ds/review-sheet.jsx | warning |
| ds-edit-review | a ticked row says "Follows the system" (reads as "no change") | "14 places — buttons, links, cards" | "Follows the system" / "1 place" | client/v2/ds/review-model.js:148 | warning |
| ds-edit-review | Version history time + casing | "1 hour ago"; lower-case summary | "Claude Code Converted from system/maude-v2 · 1 h ago" | ds/convert.ts:371; client/v2/ds/update-model.js:246 | warning |
| ds-edit-master | review doesn't say what changed | "ZAPIŠ SE › ZAPIŠ SE · Corners 2 → 6" | "Button" only | client/v2/ds/review-sheet.jsx / kinds/master.jsx | blocker |
| ds-edit-master | count line not by folder | "28 of 34 canvases use Tlačítko · by folder" | "4 of 4 canvases in Studio site" (flat list) | client/v2/ds/review-model.js | warning |
| ds-edit-master | generic, self-contradicting fine print | "Left-out canvases keep 2 px corners… Cancel puts the master back — nothing changes." | "Unticked canvases keep the old look… Cancel puts the changes back — nothing changes." | client/v2/ds/review-model.js | warning |
| ds-edit-instance | update-available block missing | "● Update available · Corners 2 → 6, by You, 10 min ago. 2026/combine was left out… · Update · Detach" | plain frame inspector | client/v2/ds/update-available.jsx (not mounted for this instance) | blocker |
| ds-edit-instance | object named by its tag | "Tlačítko · Component" | "div · Frame", "Desktop › div › div" | client/v2/inspector/model.js:28-64 (see 14 R1) | warning |
| ds-truth-outside | outside-change review never surfaces | "2 tokens changed outside the app" · "colors_and_type.css was edited by Claude Code, 4 min ago" · "Changed outside" flags · Undo / Keep | plain board | client/v2/ds/truth-card.jsx / truth-host.jsx (watcher → review) | blocker |
| ds-truth-conflict | clash card never surfaces | "Accent changed in two places" · "Pick one. Until then canvases keep Azure." · "On this canvas / In colors_and_type.css" · Use this · "2 versions" | plain board | client/v2/ds/conflict-pick.jsx | blocker |
| ds-make-inputs | — every string matches ("Make a design system for Studio site", 1/2/3 labels, "Optional", Logo/Website/Figma library, Mostly for…, AI line, Cancel / ✦ Make three directions) | | | client/v2/ds/make-model.js | **verified** |
| ds-make-directions | directions not drawn; the v1 folder view shows instead | 3 direction artboards + AI "Three directions are on the Design system canvas…" + question | "…UDE-DSN/01 design system view" (cut off), "Turn this folder into a Design system canvas · Convert…" | client/v2/ds/direction-bar.jsx; make-host.jsx | blocker |
| ds-make-directions | **R3** v1 jargon error with no verb (§4) and raw paths in the default view | — | "No tokens parsed from .design/system/club/colors_and_type.css . Does the file exist and contain CSS custom properties ( --name: value; )?" · "No preview/ or ui_kits/ folders found under…" | client/system/system-view.jsx:55,183-184 | blocker |
| ds-make-mix | same v1 view (R3) | "Use A" · "Mix with…" · "B's type — serif headlines"… · chips "Use A as it is" | — | client/v2/ds/direction-bar.jsx | blocker |
| ds-make-filling | same v1 view (R3) | "AI is setting the type" · "Brand and Colour done · 5 sections to go" · "<section> — next" | — | client/v2/ds/make-host.jsx | blocker |
| ds-make-done | same v1 view (R3) | banner "Studio site system is ready. · Studio site's 5 canvases update after a review. · Use as Studio site's style" | — | client/v2/ds/make-host.jsx | blocker |
| ds-many-switch | banner names the wrong thing (a system previewed in a system) | "Previewing Studio site in Warm paper." | "Previewing maude in maude-v2." | client/v2/ds/preview-bar.jsx:85 (passes `session.from`) | blocker |
| ds-many-switch | two actions on a banner (§4: one at most) | "Switch…" | "Switch…" + "Stop previewing" | client/v2/ds/preview-bar.jsx:99-102 | blocker |
| ds-many-switch | "esc to stop" twice; the canvas count is gone | "5 canvases shown in it · esc to stop" | sub "esc to stop" + hint "↑↓ to look · ↵ to switch · esc to stop" | client/v2/ds/preview-mode.js:97,101 | warning |
| ds-many-switch | "in use" next to a row that says no canvas uses it | | list "maude · in use" vs row "Default · no canvas uses it" | client/v2/ds/preview-bar.jsx:77 | warning |
| ds-many-switch | menu rows missing | "Open the Design system ↵" · "Make a design system…" · "Link a team library…" · "team library" note | — | client/v2/ds/preview-bar.jsx | warning |
| ds-many-library | unreachable (needs a hub team library + 3 projects) | "Update from Alligators brand system? 3 changes" · "Team library · alligators.cloud.maude.sh" | — | client/v2/ds/library-card.jsx | blocker |
| ds-many-linked | unreachable (needs a linked library) | banner "Linked from Alligators brand. · View only here — every update arrives as a review. · Open in Alligators brand" | — | client/v2/ds/library-host.jsx | blocker |
| ds-multi-panel | "Design systems · 2 in use" header, draft row and amber dot absent — fixture (one system in use); "Uses Combine 2026" not shown (nothing selected); R2 sentence present | | | — | — |
| ds-multi-schema | unreachable (no system below the schema in the fixture) | "Bring Combine 2026 up to the schema?" · "✦ Bring it up" · Adds 6 roles / Renames 2 components / … | — | client/v2/ds/upgrade-sheet.jsx | blocker |
| ds-multi-switch | count contradicts the list | "5 of 6 canvases in 2026/combine" | "0 of 0 canvases in Whole project" above 4 rows | client/v2/ds/switch-model.js | blocker |
| ds-multi-switch | disabled primary reads oddly | "Switch 5 canvases" | "Switch no canvases" | client/v2/ds/switch-model.js:47 | warning |
| ds-multi-switch | schema line cut short | "Both follow the schema — core roles and components swap; the display ramp and illustration palette pair by kind." | "…components swap." | client/v2/ds/switch-sheet.jsx | warning |
| ds-multi-switch | no Previewing banner behind the sheet | "Previewing 2026/combine in Alligators brand system. · 5 canvases shown in it" | — | client/v2/ds/switch-host.jsx | warning |
| ds-multi-menu | Rename… missing | "Rename…" | — | client/v2/ds/system-menu.jsx | blocker |
| ds-multi-menu | the default row shows a state, not a verb | "Use for new canvases · now <default>" | "Default for new canvases · this one" (a row you can click) | client/v2/ds/system-menu.jsx:38-39 | warning |
| ds-multi-menu | two labels for one action | — | menu "Preview in…" vs registry "Preview in another system…" | client/v2/ds/system-menu.jsx:60; actions/defs/ds.ts:77 | warning |
| ds-multi-menu | key hint missing | "Open Combine 2026 ↵" | "Open maude" | client/v2/ds/system-menu.jsx:27 | warning |
| ds-multi-migrate | paired frame is the panel only (sheet copy verified in ds-edge-migrate); no Convert prompt in the panel frame | | | client/v2/ds/convert-host.jsx | warning |
| ds-edge-contrast | fix verb less specific | "Lighten to 4.5:1" | "Fix to 4.5:1" | client/v2/ds/edge-model.js:71 | warning |
| ds-edge-contrast | used line hidden when the count is unknown (fixture) | "Falls short in 3 canvases · Show" | — | client/v2/ds/edge-model.js:78 | warning |
| ds-edge-trash | trash confirm has no way in from the board | "Move "Linka — jemná" to the trash? · 40 canvases use it. They switch to Linka — střední… · Move to trash" | — | client/v2/ds/trash-token-sheet.jsx (no entry point) | blocker |
| ds-edge-trash | history row: raw CSS name + "→ the trash" (§7: "moved to the trash") | "Linka — jemná moved to the trash · 40 canvases switched" | "Claude Code --object-coral → the trash · 4 canvases updated" | ds/engine.ts:400-401; ds/system-files.ts:199 | blocker |
| ds-edge-suggest | unreachable (AI signed out) | "The blue on "Save two months" was picked by hand and isn't in Studio site system. The closest is Accent. · Use Accent · Add it to the system" | — | client/v2/ds/off-system.jsx | blocker |
| ds-edge-migrate | the one-folder close-up isn't offered | "Convert system/alligators into its Design system canvas? · 42 specimen pages fold into 7 sections." + section map | "Convert 2 system folders?" (25's sheet; its copy matches 25 word for word) | client/v2/ds/convert-model.js:132 | blocker |
| ds-edge-migrate | **R6** the default is named twice, differently | — | panel "maude · Default · no canvas uses it" vs sheet "maude-v2 stays the default for new canvases" | client/v2/ds/pinned-rows.js vs convert-model.js | blocker |
| ds-advanced | Used by row missing | "Used by · Studio site · 5 canvases" | Modes · Check only | client/v2/ds/advanced.jsx | warning |
| ds-advanced | Advanced folded in the shot: "Hand off tokens ⇧⌘H", CSS/JSON, files tree, "Reveal in Finder" not seen | | "▸ Advanced Tokens · files" | client/v2/ds/advanced.jsx | warning |
| ds-advanced | history title + check card | "Version history — Studio site system ⌥⌘H"; "Check the system · ran 1 min ago" with results | "Version history"; no results card | client/v2/ds/advanced.jsx, check-card.jsx | warning |
| ds-advanced | "Which way changes flow" (3 rows), "Check the system", "Modes Light · Dark", "Restore…" | | match word for word | client/v2/ds/advanced-model.js:19 | ok |

## Root causes that hit several artboards

1. **R1 — file slug as the Design system canvas name.** The pill (client/app.jsx:1963) and ⌘K (search-model.js:339) print `design-system`. CONTRACT §7 calls it "Design system", or names it after its system when a project has several. Hits ds-where-gator, ds-board-*, ds-edit-*, ds-edge-*, ds-advanced.
2. **R2 — "Browse" in the empty inspector** (inspector-panel.jsx:688-689). CONTRACT §2 replaced the Browse tool with Preview mode. Hits every no-selection frame (where-gator, many-switch, multi-menu, multi-panel, multi-switch).
3. **R3 — an unconverted system opens the v1 folder view.** You get the "MAUDE-DSN/01 design system view" heading, raw `--token oklch(…)` grids and a jargon "No tokens parsed…" error. CONTRACT §7 says files are the Advanced layer and never the default view. Hits ds-make-*, ds-edge-migrate.
4. **R4 — raw values stand in for words.** Colour rows show `oklch(…)`, history shows `--object-coral`, names show `Fg 2`. The board and CONTRACT name things in words and keep mono for Advanced (token.jsx:278, engine.ts:400).
5. **R5 — reviews leave out what changed and where it lands.** "Corners 2 → 6", "Azure › Deeper azure", "Used in N canvases · was X · Show" and "Falls short in N canvases" are missing. The fallback "Follows the system" and the generic fine print take their place. Part of this is the fixture (no canvas follows the system); the missing *change line* is product.
6. **R6 — default / in-use words disagree across surfaces.** The pinned row, the preview list and the convert sheet each name a different default.
7. **R7 — states that exist in code but can't be reached.** Truth review, conflict, edge-trash confirm, schema upgrade, team library, AI make / suggest. Each needs product work to be reachable: a watcher-driven review, a board entry for Move to trash, a level-11 fixture, a hub, AI signed in.

```json
{"canvas":"13 Design System","critic":"copy-critic","blockers":28,"warnings":28,"verified_ids":["ds-make-inputs×light","ds-make-inputs×dark"]}
```
