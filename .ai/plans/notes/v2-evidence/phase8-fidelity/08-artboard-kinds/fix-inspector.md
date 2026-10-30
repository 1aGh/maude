# P8 stage C · C2-inspector — fix report (done vs open)

Branch `p8-c-inspector` (from feat/maude-v2 0f6b1242b). Stage D: 08 only (light + dark, inspector-bearing artboards re-shot here: ak-web-hug, ak-web-widths, ak-social, ak-safe-zones, ak-print-letak, ak-warnings, ak-advanced, ak-mixed-select, ak-video). Other canvases' pairs (03 04 07 09 12 14) were NOT re-shot — listed open.

## Done (code)
- Inspector = a 264 px hug-height card (14 `.k-insp`): no title row, no tab strip, no ✕; the dock slot is 264 wide (`app.jsx`, separate commit). Photo / element views are a `.seg` only when both apply; a placed `<img>` opens on Photo; a whole artboard is never a photo.
- Card anatomy from the kit: label left in body type fg-1 / control right, 32 px rows, 28 px section heads with 0.5 px dividers, kind chip right, crumbs nowrap with a semibold last rung, "Uses system" as the board's pill (icon well + chevron), number fields = bg-3 well, body face, unit inside ("3 mm"), token chips = accent-muted pill.
- Rows by kind: Layout only on a web page (reads "Top to bottom", flex-col is "Stacked"), Fill only on web/fixed; each object kind opens on its own sections (text Type→Fill, image Image→Adjust, shape Shape→Corners→Fill→Border→Effects, instance blocks only, several boards no Interaction/Position/Type). Position/Size stay after the board's sections for text/image (decision below).
- Names, not code: tag fallbacks are Frame / Text / Photo / Button (title, crumbs, name tag), a Layers label that is the node's own selector ("h1.dc-text-editing") is ignored, an inlined image is "Photo" (was "2Q==").
- Colours in words: a literal fill/border/text colour reads as the system's token name (Page, Ink…) or a plain word (White, Dark green); never rgb().
- Warning = first row of the inspector (block, not a row inside Artboard): warn tint + 1 px warn edge, glyph, sentence, ghost verb under it.
- ⌘A with nothing / only artboards selected takes every artboard (two-kind inspector reachable); with an object selected it keeps taking that artboard's objects.
- Add a width = `btn--sm` + glyph opening a menu; Export rows on a 1fr 1fr auto grid, full-width Export button with the download glyph; safe zones: no repeated heading, no footnote under None; W/H row has no second "Size"; instance Component select no longer overflows; print: "Follows Menu › View › Advanced › Print guides", unit after the number.

## Tests (red → green, each reverted once)
v2-inspector-render (card, photo views), v2-inspector-sections-order (per-kind sections), v2-inspector-artboard (Fill/Layout gating), v2-inspector-model (kind-word titles/crumbs, file names), edit-op-crumbs, v2-colour-words (new), use-keyboard-discipline (selectsArtboardLevel), v2-convert-dialog (warning first), kind-inspector-rows / v2-inspector-artboard (Add a width menu), v2-inspector-safe-zones, v2-inspector-print.
Known red not mine: `v2-inspector-interaction` "the line under the rows" (string drift in interaction.jsx, untouched by C2); `p8-b2/v2-floating-fit` "sidebar and right panel fill the slot" (regex vs reflowed CSS).

## 08 artboard × theme (after, this branch)
| id | light | dark |
|---|---|---|
| ak-web-hug | fixed (card, rows, Top to bottom, Add a width); select/segment chrome = C1 | fixed (same) |
| ak-web-widths | fixed (menu); sibling widths not driven | same |
| ak-social | fixed (rows, no Layout, no heading repeat); Size "Custom" is the fixture | same |
| ak-safe-zones | inspector fixed; band colours / floating platform list still differ (canvas overlay RC-5 = C5, select = C1) | same |
| ak-print-letak | fixed (mm, notes, warn row first); switch/seg chrome = C1 | same |
| ak-warnings | inspector fixed; label mark (16 px filled dot) = C5 | same |
| ak-advanced | frame re-shot; fold-open step needs the `fold-inspector-toggle` click verified in dark | still differs (inspector closed in the dark run — harness) |
| ak-mixed-select | light: harness still lands on objects; dark frame invalid (focus in left panel) — needs a re-drive after Esc | invalid |
| ak-video | still differs: inspector not open with the timeline up (07/C3 owns the island; no "Length" field yet) | same |
| ak-convert / -after | unreachable: harness step (`insp-ab-preset` select option) timed out — product exists (ConvertDialog) | same |
| ak-picker*, ak-mixed-fit/filter, ak-print-view, ak-real-* | not C2 (unchanged) | |

## Open (not done)
1. **Photo inspector for readable-name images**: the photo pipeline is content-addressed end to end (`assets/<sha8>.ext` in `dom-selection.ts:569`, `inspect.ts:315`, `canvas-lib.tsx:3608`, `api.ts` photo-edit sidecar). Mounting it for `assets/IMG_2231.jpg` needs server + canvas-lib work (a name→sha map or widening all five matchers). Proposed split: own task "photo edits keyed by asset id". 12 `ia-photo-inspector` / `ia-photo-steps` stay unreachable meanwhile.
2. 04 "compact property card in Edit": followed 14 (owner of editing) → full per-kind sections in the hugging card; On click / Border/ Fill rows exist but sit below the fold on a tall button.
3. 14 finer rows: W/H fields + Clip switch on a web artboard (08 wins: not drawn there), Language row + tie marks (text), Layout "Convert to absolute" folded into Advanced, constraint diagram, free-placement tip card, Align tile, instance Variant chip row, Padding one-row token chip, "Tokens it uses" chips in Advanced, token chips instead of "Bind" (needs a bound system in the fixture).
4. Multi-artboard inspector values (Preset "Story 9:16", X/Y Mixed, Background swatches) not checked after the ⌘A change.
5. Video inspector: Length as a field with clock; Sound row says "None yet" while Music holds a song (`video-facts.js` reads `/_api/comp-clips`).
6. Crop-mode inspector (Image + Adjust only) — sections now match; crop-mode-specific hide of Position not done.
7. "COMBINE2026" glued text (selection `text`) not reproduced from the code (`shortText` already uses innerText).
8. Shared-kit items left to C1: native `<select>` appearance, pressed-segment ring, switch knob, `.btn` / ghost button styles (the warn verb and "Add a width" use `btn` classes that C1 styles).
9. Stage D for 03 (ai-open), 04 (md-edit), 07 (ve-select), 09 (ex-inspector), 12, 14: not re-shot.

## Decisions
- `decision:maude/v2-c2-inspector-card`: the inspector is a hug-height 264 px card with no tab strip / title / ✕ — 14 `.k-insp` + 08 + 03 critics; rejected: keeping a docked full-height panel with restyled controls.
- `decision:maude/v2-c2-14-owns-sections`: section heads and per-kind sections follow 14 (owns editing); 08's flat artboard rows only drive WHICH rows exist per kind; 04's compact card is its first rows. Rejected: flat rows for objects.
- `decision:maude/v2-c2-geometry-after-board-sections`: text and image keep Position/Size after the board's sections (board silent) so numbers stay reachable.
- `decision:maude/v2-c2-select-all-by-level`: ⌘A selects every artboard when nothing/only artboards are selected, else the artboard's objects. Rejected: a separate chord.
- `decision:maude/v2-c2-warning-is-a-block`: the artboard warning registers as a top block, not a row in a section.

## Round 2
See fix-insptl.md in 08-artboard-kinds/ (inspector rest: Length well, Sound pill, Combine icons; open: photo-by-asset-id split).
