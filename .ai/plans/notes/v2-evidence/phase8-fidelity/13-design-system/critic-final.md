# critic-final — 13 Design System · phase 8 stage D2 (final, merged tip d3881fe41)

_2026-10-24 · one critic, four lenses · read-only · pairs read: committed `<id>-<theme>.jpg` (spec left, impl right); light read for every re-shot id, dark read for board-gator, make-mix, truth-conflict, edge-migrate; the other dark twins share surface and root cause with their light pair (same blockers, no dark-only fix landed) so they stay `differs`._

**Result: 0 of 30 match; 26 differ, 4 unreachable.** Round 4 made no change that closes a blocker: the board body, make states, review/master sheets, truth/conflict and instance states remain different from the board; several frames (edit-reach, edit-review, edit-master, truth-*, multi-migrate, edge-trash) do not even show the spec's surface.

| id | theme | verdict | remaining blockers |
| --- | --- | --- | --- |
| ds-where-studio | light | differs | 'Uses maude-v2' is a full-width row under the inspector title (spec: pill after Fill); inspector Export/Layout/Fill (spec Preset/Size/Fill); pinned rows are two file rows 'maude'/'maude-v2' (spec one 'Design system · used by 1 project' row); extra Recent/kind chips/Trash foot. |
| ds-where-studio | dark | differs | same as light |
| ds-where-gator | light | differs | palette has no 'In the Design system' group and no Actions group (Check the system / Switch…); lists Canvases + Artboards; no right-hand meta; empty-inspector hint; palette width not 580. |
| ds-where-gator | dark | differs | same as light |
| ds-board-studio | light | differs | board body still not the specimen: Brand = tiny hero + logo tile, no logo lockup/icons/voice/Say-not/Rules; Patterns 'No patterns yet' (spec 5 real screens); sections at other sizes; Colour/Type/Components thinner than spec; extra showcase artboards under the board. |
| ds-board-studio | dark | differs | same as light |
| ds-board-dark | light | differs | same as ds-board-studio (Patterns empty, Brand thin, section sizes); bar island is right. |
| ds-board-dark | dark | differs | same as light |
| ds-board-gator | light | differs | same as ds-board-studio; fixture shows maude-v2 not Alligators; no locked-colour lock glyph. |
| ds-board-gator | dark | differs | same as light |
| ds-edit-colour | light | differs | selection = Colour artboard handles + size tag, not a 2 px ring on the swatch; Advanced collapsed (spec open with light/dark/token rows); contrast line one-line 'Light 4.8:1 · Dark 4.7:1' (spec '5.6:1 on white · 4.8:1 on the dark page'); no 'Deeper azure' value, no 'Used in 5 canvases · Show' row; canvas not framed like the spec (zoomed far out). |
| ds-edit-colour | dark | differs | same as light |
| ds-edit-reach | light | differs | reach view not drawn: shot shows the legacy 'design system view' token grid, not the one-colour-everywhere flow with the review sheet. |
| ds-edit-reach | dark | differs | same as light |
| ds-edit-review | light | differs | shot shows the legacy token grid, no review sheet at all in this frame (spec: 'Update canvases with the new Accent?' sheet over the board). |
| ds-edit-review | dark | differs | same as light |
| ds-edit-master | light | differs | no review sheet in the frame; impl is the Advanced inspector of the board (spec: 'Update canvases with the new Tlačítko?' with master pair, by-folder list). |
| ds-edit-master | dark | differs | same as light |
| ds-edit-instance | light | differs | update-available block (Update · Detach) not mounted; impl is a plain frame inspector on a different canvas (Homepage Pricing, not a Tlačítko instance). |
| ds-edit-instance | dark | differs | same as light |
| ds-truth-outside | light | differs | no 'N tokens changed outside' card / flags / Undo·Keep; impl is the legacy token grid. |
| ds-truth-outside | dark | differs | same as light |
| ds-truth-conflict | light | differs | no 'Accent changed in two places' pick cards; impl is the plain board with a green Review… button. |
| ds-truth-conflict | dark | differs | same as light |
| ds-make-inputs | light | differs | tiles are a 2-col bordered grid (Logo/Website/Figma library), spec 4 across with icon, check badge, 'Your canvases' tile; textarea empty vs filled and primary disabled (fixture); backdrop Studio-site canvas list, spec Home. |
| ds-make-inputs | dark | differs | same as light |
| ds-make-directions | light | differs | three Direction A/B/C artboards are tiny thumbs, not three large artboards with swatch strip, headline, buttons, 'Made by AI' tags, rationale; seven sections empty outlines; no AI card/question; bar names 'club'. |
| ds-make-directions | dark | differs | same as light |
| ds-make-mix | light | differs | no 'Use A · Mix with…' bar or parts menu, no AI card; Direction thumbs tiny, sections blank white (dark theme shows white boxes). |
| ds-make-mix | dark | differs | same as light |
| ds-make-filling | light | differs | no 'AI is setting the type' tag, no progress card, no 'Made by AI' tags; sections blank outlines. |
| ds-make-filling | dark | differs | same as light |
| ds-make-done | light | differs | no 'Studio site system is ready · Use as Studio site's style' banner, no 'Made by AI' tags, no AI done card; sections thin green-tinted boxes; Patterns empty. |
| ds-make-done | dark | differs | same as light |
| ds-many-switch | light | differs | banner reads 'Previewing maude in maude-v2.' + 'esc to stop' (no '5 canvases shown in it'); menu hangs under the banner not at the Design system row; rows maude/maude-v2 not Studio site system / Warm paper / Alligators; no check/draft notes; panel not the 'Design system' row; canvas not restyled. |
| ds-many-switch | dark | differs | same as light |
| ds-multi-panel | light | differs | pinned rows two plain file rows, no 'Design systems · 2 in use' header, no Default·87 canvases sub-line, no amber dot; inspector shows the empty hint (no 'Uses Combine 2026' door); fixture is Studio site not Alligators. |
| ds-multi-panel | dark | differs | same as light |
| ds-multi-menu | light | differs | menu laid over the pinned rows, no highlighted item or key hint, no 'Rename…', 'Default for new canvases · this one' not 'Use for new canvases · now <default>'; extra 'Preview in…'/'Check the system'. |
| ds-multi-menu | dark | differs | same as light |
| ds-multi-switch | light | differs | 'None of the 4 canvases in Whole project can switch' with 4 unticked rows + 'Switch no canvases' (spec: scoped folder list with 5 of 6 ticked); blank grey thumbs; scope Whole project; no 'AI restyles' toggle; no Previewing banner behind. |
| ds-multi-switch | dark | differs | same as light |
| ds-multi-migrate | light | differs | frame shows 'No canvas open' empty state with the AI panel; no 'Convert 3 system folders?' sheet. |
| ds-multi-migrate | dark | differs | same as light |
| ds-edge-contrast | light | differs | warning '2:1 on Bg 4, Bg 3 and Bg 0 in Light and Dark · Fix to 4.5:1' vs '3.1:1 on Pole and Hover · Lighten to 4.5:1'; no 'Role · Text on green' row; no 'Falls short in 3 canvases · Show'; Advanced collapsed; Dark-mode editing/selection ring differ; canvas zoomed far out vs spec. |
| ds-edge-contrast | dark | differs | same as light |
| ds-edge-trash | light | differs | no 'Move X to the trash?' sheet from the board; impl is Advanced inspector view. |
| ds-edge-trash | dark | differs | same as light |
| ds-edge-migrate | light | differs | sheet is 'Convert 2 system folders?' two-row list, not the one-folder 'Convert system/alligators into its Design system canvas?' section map (42 pages → 7 sections); legacy token grid under the scrim. |
| ds-edge-migrate | dark | differs | same as light |
| ds-advanced | light | differs | no 'Used by · Studio site · 5 canvases' row; Advanced collapsed (no CSS|JSON seg, token block, Files tree, Hand off tokens, Reveal in Finder); Version history one row w/o '— system ⌥⌘H'; no Check result card; left panel shows the legacy Advanced file tree. |
| ds-advanced | dark | differs | same as light |
| ds-edge-suggest | light | unreachable | needs signed-in AI + a canvas with a hand-picked off-system colour so the off-system question raises |
| ds-edge-suggest | dark | unreachable | needs signed-in AI + a canvas with a hand-picked off-system colour so the off-system question raises |
| ds-many-library | light | unreachable | needs a loopback hub with a team library read by 3 projects |
| ds-many-library | dark | unreachable | needs a loopback hub with a team library read by 3 projects |
| ds-many-linked | light | unreachable | needs a hub-linked library so the project goes view-only with the 'Linked from…' banner |
| ds-many-linked | dark | unreachable | needs a hub-linked library so the project goes view-only with the 'Linked from…' banner |
| ds-multi-schema | light | unreachable | needs a below-schema fixture system (amber dot) so the upgrade sheet opens; only 'Bring it up' needs AI |
| ds-multi-schema | dark | unreachable | needs a below-schema fixture system (amber dot) so the upgrade sheet opens; only 'Bring it up' needs AI |
