# P8 stage C · round 3 · c3-inspect — fix report (done vs open)

Branch `p8-c3-inspect` (from feat/maude-v2 08378d2f3). Scope: area inspector card + selection (stage-D critic rows R5 / A / R4 / selection for 01 04 08 14).

## Done (code)
- **The page root is the artboard** (`input-router.tsx` `pageRootOf` / `dropPageRoot` / `isPageHit`; `canvas-shell.tsx` dblclick ladder; `use-artboard-drag.tsx`). An artboard's page is ONE stamped root element that fills the artboard. A plain click used to climb to it, so every click read "Frame 1440 × 996" and opened the object inspector for the page (01 cf-select-tweak, 14 ed-ab-arrange / ed-obj-*). Now:
  - a click on the page itself selects the **artboard** (no element id) → the artboard card (Preset · Size · Fill · Corners · Clip · Export);
  - a click on an object selects the **top object below the page** (14: "click selects the top object; double-click goes inside"); ⌘-click is still the deepest; ⇧-click adds top objects;
  - the double-click ladder starts below the page (the page is not a rung);
  - a page smaller than the artboard (a lone card) keeps today's behaviour (it is an object, not the page);
  - a **press on the page drags the artboard** (same drag, same guides / equal-gap chips / X·Y pill as the label), a press on an object is that object's.
- **The inspector comes with an artboard selection** (`v2/shell/inspector-follow.js` `isFollowable`, one line in shared `use-shell-core.jsx`): `shouldOpenOnSelect` required an element id, so selecting a whole artboard never opened the card (the harness opened it by hand every time).
- **Convert layout to absolute lives in the folded Advanced** (`kinds/frame.jsx`): a registered Advanced row (`css.convert-to-absolute`, above the CSS the frame writes, with the "Each card keeps where it is now…" note) instead of an inline "Advanced / Convert children to absolute position" block under Layout (14 ed-inspector, ed-lay-free). Label is the board's "Convert layout to absolute". Testids kept (`insp-layout-convert`, `-note`); `insp-layout-advanced` retired (TESTIDS.md / testids.json updated).
- **Names are words** (14 R4): the inspector title of an unnamed FRAME is its own words (the last crumb: own text, else "Frame"), no longer everything inside it glued ("Brand systems Logos, ty…") — `model.js titleOf`; the reorder tag follows the crumb rule (`reorder-slot.tsx nameOf`: "Frame · moves to 3 of 5", never "ct designApps and … · moves to 3 of 5" or a tag); a path of more than three rungs folds to "Desktop › … › the object" with every shown rung whole (`crumbs.jsx`, the folded names are the "…" title).
- **Resize**: the name chip and the pill beside the pointer read ONE size while an edge is dragged (`artboard-handles.tsx chipSize`): the chip used to read what the page managed to render (1058) beside a pill reading what the drag asked for (1052).

## Tests (red → green, each reverted once)
`page-root-is-the-artboard` (new: root collapse, small-page guard, ⌘ deep, drill ladder, page press = artboard press), `reorder-slot-name` (new), `v2-inspector-model` (frame title), `edit-op-crumbs` (folded path), `v2-inspector-layout-frame` (Convert in the open fold, not under Layout), `v2-right-islands` (isFollowable + the shell asks it), `v2-artboard-canvas` (chipSize).
Known red not mine: the three `slot registry` tests in `v2-inspector-model` fail when run after other inspector files in ONE bun process (also at the round start: frame.jsx at feat/maude-v2 reproduces it).

## Stage D
14 Editing re-shot (light + dark) with the g5 harness; changes to the harness (committed in `_d-harness-g5/`): `g5.mjs` `pageHit` + modifier-aware `click`, `s14a/b/c` drill counts (the page is no longer a rung; ⌘⇧-click for several objects, which the old `mouse.click(.., {modifiers})` silently ignored), `mkpairs.mjs` `ONLY_EXISTING=1`.
01 cf-select-tweak / cf-duplicate-width / cf-frames-text and 04 md-edit* were NOT re-shot (their harnesses need the fake-agent and the g1/g2 spec dirs): listed open.

## Open
1. **Two boards disagree on a Button's card.** 04 md-edit draws a compact card of the rows the object HAS (Size · Fill · Border · On click · On hover · Advanced "5 properties"); 14 ed-inspector draws every section (Position … Export, folded Advanced). The product follows 14 (round 2 decision `v2-c2-14-owns-sections`) so a Button's card is long. Lead call needed: keep 14 for every object, or a compact variant in 04's frame.
2. "Tokens it uses" (14 ed-inspector) vs "Tokens bound" (06 ad-inspector): the fold is 06's, left as 06 words.
3. Live inspector during an artboard resize ("Preset: Laptop · 1280" follows the drag, ed-ab-resize): needs a canvas→shell live-size message + an inspector override; not built.
4. ed-ab-arrange guides / "80" chips only show when the drop is inside the snap range of the row (fixture geometry); the drag, the lifted shadow and the X·Y pill are there.
5. R3 chrome at rest (tab-order pills, magenta spacing dots, rotate/corner dots over a pointer selection) — not this round's area.
6. 14 finer rows still open from round 1: constraints diagram, free-placement tip card, Align tile, instance Variant chips, Padding one-row token chip, "Tokens it uses" chips, Language row.
7. Layers panel still lists the page root as a row (the boards list Nav · Hero · … directly under the artboard).

## Decisions
- `decision:maude/v2-c3-page-root-is-the-artboard`: an artboard's single filling root element IS the artboard for selection, hover, drill and drag — rejected: a "first click selects the artboard" two-step (breaks 14's "click selects the top object"), per-fixture harness clicks only (leaves the product wrong).
- `decision:maude/v2-c3-inspector-follows-artboard`: the inspector opens with an artboard selection too — rejected: leaving it to the dock toggle.
- `decision:maude/v2-c3-convert-in-advanced-fold`: Convert is an Advanced-fold row, label from 14 — rejected: keeping the inline Layout block with a restyle.
