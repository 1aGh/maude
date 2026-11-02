# critic-d — 13 Design System · phase 8 stage D

_2026-10-24 · one critic, four lenses · read-only · pairs re-shot on 6d19daa9a (stage D) · sources: INDEX.md, critic-design/copy/a11y/signature.md, fix-dsedit.md, full-size pairs at `.claude/worktrees/agent-a57a21718e6d25731/.scr/pairs/13-design-system`_

**Result: 0 of 30 ids match in both themes; 26 differ, 4 unreachable.** Stage C round 2 (C12) landed the DS bar island (RC2), kit sheet metrics (RC4), part of the token block (RC5), the preview banner, the `system` glyph and the 'Design system' name; it explicitly left RC1 (board body), RC6 (make states), the drawn picker, swatch ring, review change lines, truth/conflict/trash/instance states, system-menu anchor and the ⌘K group open. Dark and light differ the same way unless noted (the dark Edit toolbar wash D1 is gone). `fix-dsedit.md` did not mark any id matched.

| id | theme | verdict | remaining blockers |
| --- | --- | --- | --- |
| ds-where-studio | light | differs | Uses door sits under the inspector title as a radius-md bar, not after Fill + separator as a 28 px pill with round glyph tile (frame.jsx:214-217, uses-link.jsx); pinned row still `maude`/`maude-v2` file rows with 'Default · no canvas uses it' (copy, contradicts §7); kind-gated inspector shows Export/Layout/Fill rows vs the board's compact Preset/Size/Fill card (inspector builder open); left panel keeps kind-chip row, Recent, Trash foot. Fixed since B: system glyph, accent-text ink, dark toolbar (D1 gone). |
| ds-where-studio | dark | differs | same as light |
| ds-where-gator | light | differs | Not fixed: no 'In the Design system' group, no Actions group (Check the system / Switch…), palette 640 w / 12vh not 580 / top 56, selected row is accent-tint with filled tile, 'Browse' in the empty inspector (copy R2: impl still says 'Press V, then click… or ⌘-click straight from Preview' — R2 word gone, but fix-dsedit lists the ⌘K group as open). Pill now 'Design system'. |
| ds-where-gator | dark | differs | same as light |
| ds-board-studio | light | differs | RC1 open (fix-dsedit): no board hero (glyph tile, count line); Brand = name + 4 tiles with a broken spark.svg <img>, no icons / voice / Say-not / rules; Colour = file groups ('Bg 0') not role groups, no 'Text on surfaces' pairs, clipped at 620; Type = 'Hamburgefonstiv' font rows + sizes in alphabetical order with one ellipsised sentence; Space radii alphabetical, no Layout grid; Motion = bars + raw curves not 4 cards; Components = bare words not a variants x states grid; Patterns empty ('No patterns yet'). Showcase artboards now render (X3 gone) and bar is a v2 island. |
| ds-board-studio | dark | differs | same as light |
| ds-board-dark | light | differs | Bar is now a v2 island with glyph tile + seg (RC2 fixed) but the pill still reads 'Studio site / Design system' only after C2 rename (ok) — remaining: same board-body blockers as ds-board-studio (RC1: hero, Brand, Colour role groups + pairs, Type roles, Space order + Layout, Motion cards, Components grid, Patterns), dark specimen values not checkable beyond swatches. Light|Dark seg on the bar matches. |
| ds-board-dark | dark | differs | same as light |
| ds-board-gator | light | differs | Same RC1 board-body blockers as ds-board-studio (impl shows maude-v2, not a second system: fixture); no locked-colour lock glyph on the board (section-colour.tsx); bar island OK. |
| ds-board-gator | dark | differs | same as light |
| ds-edit-colour | light | differs | Picker is still the native colour input + oklch text field (no drawn L/C square 92 h + hue rail, token.jsx:286-317); swatch selection is the Colour ARTBOARD handles + '993 x 620' tag, not a 2 px accent ring on the swatch (inspect overlay for [data-ds-token] open); Light row shows 'Accent' name and 'Dark follows Light' ok, but the extra 'Light value' / 'Name this colour' rows remain; contrast line is one-line '✓ Light 4.8:1 · Dark 4.7:1', not '5.6:1 on white · 4.8:1 on the dark page' (copy); 'Used in N · was · Show' absent (fixture). Review… = primary button now (fixed). |
| ds-edit-colour | dark | differs | same as light |
| ds-edit-reach | light | differs | Reach view still unreachable in the shot (no canvas follows the system); impl shows the plain token inspector. Product/fixture work: a system-styled canvas so 'Show' appears. |
| ds-edit-reach | dark | differs | same as light |
| ds-edit-review | light | differs | Sheet metrics now kit-like, but: swatch pair shows '■ › ■ Accent' not 'Azure › Deeper azure' (review-sheet.jsx:225-227); rows are blank grey 116 x 72 boxes, not canvas renders ringed where the token sits; row sub-lines 'Follows the system' / '1 place' not '14 places — buttons, links, cards' (copy R5, review-model.js:148); count '4 of 4' vs '4 of 5' with Landing left out is fixture; Version history row 'Claude Code Converted from system/maude-v2' (copy). |
| ds-edit-review | dark | differs | same as light |
| ds-edit-master | light | differs | Review sheet names the master only ('Button' in bold) — no old -> new master pair, no 'Corners 2 -> 6' (review-sheet.jsx:236-240); flat canvas list, no folder grouping / 'by folder' count; generic fine print; blank thumbs. Sheet metrics fixed. |
| ds-edit-master | dark | differs | same as light |
| ds-edit-instance | light | differs | Update-available block (Update · Detach, 'Corners 2 -> 6, by You') not mounted for a component instance — impl is the plain frame inspector (div · Frame). Unreached state (update-available.jsx). |
| ds-edit-instance | dark | differs | same as light |
| ds-truth-outside | light | differs | '2 tokens changed outside the app' card, 'Changed outside' flags and Undo / Keep never surface (truth-host.jsx waits on a ds:outside push the studio does not send); impl = plain board. Product work: push ds:outside / lower the quiet window. |
| ds-truth-outside | dark | differs | same as light |
| ds-truth-conflict | light | differs | 'Accent changed in two places' pick cards and '2 versions' flag never surface; plain board (conflict-pick.jsx via the same host). |
| ds-truth-conflict | dark | differs | same as light |
| ds-make-inputs | light | differs | Sheet is 640 w, kit-dialog metrics, copy matches word for word. Remaining: learn-from tiles are a 2-column grid of bordered rows (Logo / Website / Figma library), not 4 across 142 x 72 --bg-3 tiles with icon on top and a check badge (make.css:56-100); no 'Your canvases' tile (fixture); sentence textarea is empty with a visible focus ring vs filled (fixture) but keeps native resize grip; fine-print mark grey sparkle vs coral Spark (make-sheet.jsx:230); primary is disabled outline (fixture + X2), not filled btn--primary. Dark twin same. |
| ds-make-inputs | dark | differs | same as light |
| ds-make-directions | light | differs | RC6 open: ds make/draft open the legacy folder view ('DE-DSN/01 design system view', clipped mono heading, 'No tokens parsed'); no 3 direction artboards, no Preview toolbar, no AI card. Product work: make verbs must write the Design system canvas. |
| ds-make-directions | dark | differs | same as light |
| ds-make-mix | light | differs | Same as ds-make-directions: no 'Use A · Mix with…' bar / parts menu; legacy folder view shown. |
| ds-make-mix | dark | differs | same as light |
| ds-make-filling | light | differs | Same RC6: no dashed section outlines, no 'AI is setting the type', no progress card; legacy folder view. |
| ds-make-filling | dark | differs | same as light |
| ds-make-done | light | differs | Same RC6: no 'Studio site system is ready · Use as Studio site's style' banner, no 'Made by AI' tags; legacy folder view. |
| ds-make-done | dark | differs | same as light |
| ds-many-switch | light | differs | Closer (banner top-centre island, one action, menu under it, doors added) but: banner reads 'Previewing maude in maude-v2.' not the project 'Previewing Studio site in Warm paper.' and sub-line is only 'esc to stop' (no '5 canvases shown in it'); the menu hangs under the banner, not anchored to the pinned row at the panel edge; menu rows plain with 'in use' / 'previewing' notes at fg-2 on accent-soft (3.74 L / 2.19 D, a11y blocker not shown fixed); pinned row is not the 'Design system' row; no draft / team-library rows (fixture). |
| ds-many-switch | dark | differs | same as light |
| ds-multi-menu | light | differs | Menu still laid over the pinned rows and covers 'maude-v2' (spec: below / right of the row at left 252, row stays accent-tint with ⋯ visible); 236 w not 340, no highlighted item, no ↵ key hint, no 'Rename…' (copy blocker); 'Default for new canvases · this one' not 'Use for new canvases · now <default>'. |
| ds-multi-menu | dark | differs | same as light |
| ds-multi-migrate | light | differs | Panel shows the two unconverted systems as plain rows; no Convert affordance on a row, no sheet over the board in this frame, rows are bordered table rows in the sheet not --bg-3 rows with right chips (convert-dialog.jsx); legacy folder view under the sheet. |
| ds-multi-migrate | dark | differs | same as light |
| ds-multi-panel | light | differs | Pinned rows are two plain file-named rows ('maude' / 'maude-v2', sub-lines '·no canvas uses it') under a 'Studio site' kind-chip panel; no 'Design systems · 2 in use' header, no amber 'made before the schema' dot (fixture), nothing selected so the 'Uses Combine 2026' door is not shown (fixture) — and the inspector in the shot is the empty 'Press V…' hint, so the board's 'inspector names the system that canvas uses' is not demonstrated; cannot confirm. |
| ds-multi-panel | dark | differs | same as light |
| ds-multi-switch | light | differs | Sheet metrics fixed, but: '0 of 0 canvases in Whole project' above 4 unticked rows and 'Switch no canvases' (copy blocker, switch-model.js); rows are blank grey thumbs (spec renders 44 x 32); scope default 'Whole project' vs 'Folder'; schema line cut short; no AI-restyles toggle (fixture); no Previewing banner behind the sheet. |
| ds-multi-switch | dark | differs | same as light |
| ds-edge-contrast | light | differs | Warning is now a .ds-line block with 'Fix to 4.5:1' as an accent action inside (fixed), but: picker still native (RC5), 'Role · Text on green — hints' row absent, text reads '2:1 on Bg 4, Bg 3 and Bg 0 in Light and Dark' with 'Fix to 4.5:1' vs '3.1:1 on Pole and Hover · Lighten to 4.5:1' (copy), swatch name 'Fg 2' (fixture-ish), 'Falls short in 3 canvases · Show' absent (fixture), live region for the contrast line open (a11y). |
| ds-edge-contrast | dark | differs | same as light |
| ds-edge-trash | light | differs | Trash confirm sheet ('Move X to the trash? 40 canvases use it…') has no entry point from the board (trash-token-sheet.jsx); impl shows only the history line '--object-coral -> the trash' with a raw CSS name (copy blocker, engine.ts:400). |
| ds-edge-trash | dark | differs | same as light |
| ds-edge-migrate | light | differs | Sheet is 'Convert 2 system folders?' with a two-row folder list, not the one-folder 'Convert system/alligators into its Design system canvas?' section map (42 pages -> 7 sections, convert-model.js:84-104); the folder view under the scrim is the legacy token grid; 'default' named differently on panel vs sheet (R6). |
| ds-edge-migrate | dark | differs | same as light |
| ds-advanced | light | differs | Not touched by round 2: no 'Used by · Studio site · 5 canvases' row (advanced.jsx:125; the system has 4 canvases); Advanced is a collapsed chevron row 'Tokens · files' (spec open: CSS | JSON seg, mono token block, Files tree, Hand off tokens ⇧⌘H, Reveal in Finder); Version history title lacks '— <system>  ⌥⌘H' and shows one pencil tile; Check card has no results; flow card glyph layers vs system; also the left panel shows the legacy folder tree open instead. |
| ds-advanced | dark | differs | same as light |
| ds-edge-suggest | light | unreachable | needs AI signed in (or a stub offering the closest system colour) plus the off-system chip being drivable: a fixture canvas with a hand-picked off-system colour so off-system.jsx raises its question. |
| ds-edge-suggest | dark | unreachable | needs AI signed in (or a stub offering the closest system colour) plus the off-system chip being drivable: a fixture canvas with a hand-picked off-system colour so off-system.jsx raises its question. |
| ds-many-library | light | unreachable | needs a loopback hub with a team library read by 3 projects (library-card.jsx / library-host.jsx). |
| ds-many-library | dark | unreachable | needs a loopback hub with a team library read by 3 projects (library-card.jsx / library-host.jsx). |
| ds-many-linked | light | unreachable | needs a hub-linked library so the project row goes view-only and the 'Linked from …' banner shows (library-host.jsx, VIEW_ONLY_WORDS in ds-bar.tsx). |
| ds-many-linked | dark | unreachable | needs a hub-linked library so the project row goes view-only and the 'Linked from …' banner shows (library-host.jsx, VIEW_ONLY_WORDS in ds-bar.tsx). |
| ds-multi-schema | light | unreachable | needs a fixture system below the current schema (amber dot) so upgrade-sheet.jsx opens; only 'Bring it up' needs AI. |
| ds-multi-schema | dark | unreachable | needs a fixture system below the current schema (amber dot) so upgrade-sheet.jsx opens; only 'Bring it up' needs AI. |
