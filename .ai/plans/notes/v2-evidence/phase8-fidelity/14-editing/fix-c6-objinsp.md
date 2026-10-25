# P8 stage C · round 6 · c6-objinsp — fix report (done vs open)

Branch `p8-c6-objinsp` (from feat/maude-v2 4fc89c1a4). Scope: the OBJECT inspector on 14 (ed-inspector, ed-lay-auto, ed-obj-enter, ed-comp-instance, ed-text-edit). Files: `client/v2/inspector/{frame.jsx,model.js,sections.js,sections/*,kinds/frame.jsx}`.

## Done (code)
- **An object a layout places has no X · Y of its own** (14 ed-obj-enter): Position reads "In Services — Set by Services · 2 of 3" (the frame's name and the object's place among its children, from the Layers tree: `model.js placementOf`, `ctx.placement`), then **Place freely as a switch** (off; turning it on runs `object.place-freely`) and the "← → move it earlier or later" line in its own soft box. No X · Y / Rotation / "It sits where…" paragraph in that state; a placed object keeps X · Y · Rotation · Constraints.
- **Who leads the card** (ed-lay-auto vs ed-obj-enter): a frame that runs an auto layout and that no layout places leads with Layout, then Size, then Position (`sections.js sectionsFor(kind, { layoutFirst })`); the same frame inside another layout keeps Position first.
- **Padding on one row** (ed-inspector / ed-lay-auto): four alike sides read as ONE token chip ("Space 24", `insp-chip-pad-all`); H · V show only when they differ ("H Space 24 · V 10 Bind"); the per-side icon moved from the Padding row to the Layout header (like Corners' unlink); the row no longer wraps in the 264 card (compact chips, no wrap, 26 px number).
- **Token chips** read the bound token with 14's token glyph (a diamond outline instead of a dot) and never break across two lines ("Space\n24").
- **Size · weight** (Type): the size field and the weight select no longer overlap — the row wraps its value under the label when the card is too narrow.
- **`Line`** (14 `.ed-line`): a status sentence draws in its own soft box (`Quiet line`), used for the Place freely line.

## Stage D
5 ids re-shot (light + dark) with the g5 harness; changes to it (committed in `_d-harness-g5/`): the Homepage fixture is a BOUND project (the Services row, cards, nav button and "See the work" use `var(--space-5)`, `var(--radius-pill)`, `var(--radius-lg)`, `var(--fg-0)` …) and the nav's "Book a call" is a real `<button>` pinned right/top (so ed-inspector shows Position X · Y + Constraints like the board); the Alligators title carries `lang="cs"`; `s14b.mjs` (gators branch) shoots ed-text-edit on the Alligators "Zapiš se" post. `c6.mjs` is a one-object inspector crop (T=book|brand|services|title|inst).

## Open
1. Advanced › "Tokens it uses" is 06's property → `--token` rows, not 14's chips (Ink · Page · Space 8 · Round · Resting …); 06 owns that group (decision v2-p8-inspector-full-per-14 left it).
2. Instance Variant flyout (the menu with "Plné ✓ / Obrys / Your text and colour come along") is still a Select; override dots + "N changes · Reset" + "Update … for every canvas…" exist and show once the instance has overrides (the harness does not make one).
3. Export "This object" row (09 owns the section: v2-p8-c5-export-owned-by-09); Interaction "On click" shows None unless the fixture button has a link.
4. The harness' design system is maude-v2 (names "Pill", "LG"), not the board's "Studio site system" (names "Round", "Space 24" on a "Ink" colour), so the chips read the right shape with the system's own words.
5. ed-text-edit: no text style in the fixture ("Plakát") so "Uses … brand system" / the style row differ; the zoomed poster framing is not the shot.
6. **Fill reads "None" for a `background: var(--token)` shorthand** on the harness's Book a call button (the CSS shows it bound); `fillFromCss` handles `var(--ink)` in a unit test, so the loss is between the selection payload's `authored` map and the Fill section (not traced). The harness keeps the hex fill until it is.
7. Characterization snapshots (`test/characterization/v1/browser__inspector-selected.txt`, `keys.txt`) list `insp-sides` inside the Padding row and the H / V pair; the DOM moved (header icon, one chip for alike sides) — the lead's `check-v1-characterization --update` pass regenerates them.
