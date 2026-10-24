# P8 stage C · round 5 · c5-inspector — fix report (done vs open)

Branch `p8-c5-inspector` (from feat/maude-v2 acb712da0). Budget stop at ~300k tokens: the artboard card and one object-inspector word are done; the drag states and the finer object rows are open.

## Done (code)
- **The web page's artboard card is 14 ed-ab-select** (`kinds/artboard-web.jsx`, `artboard.jsx`, `artboard-rows.jsx`, `artboard-advanced-rows.jsx`, `frame.jsx`): Artboard ▸ Preset · Size (W · H) · Height (+ "N now — grows as you add.") · Clip content; Fill ▸ Background; Layout ▸ Content; Export; **Other widths last** (a bottom block, `artboard.other-widths`). The exact W · H and Clip content left the Advanced fold for a web page (the fold keeps Padding, Gap, Kind, the facts); the "Uses <system>" line is not drawn on an artboard card (14 draws none there; an object keeps it). Fixed-size, video and print cards are unchanged (08 / 07 own them).
- **Advanced tokens group reads "Tokens it uses"** (14 ed-inspector; decision v2-p8-inspector-full-per-14).
- Stage D harness: `s14a.mjs` drags the right edge exactly to the Laptop 1280 preset (so the shot shows the snap, the lit ruler stop and "Laptop · 1280 × 1573"), not an arbitrary 1116.

## Tests (red → green)
`v2-inspector-artboard` (card rows / labels / section heads / Other widths after Export / no Uses; W·H and Clip no longer behind Advanced) and `kind-inspector-rows` (web rows) were red against the old card (7 + 1 fails) and green after; `v2-inspector-advanced` "Tokens it uses" red → green.
Known red not mine: `gate-b-polish1-scope` ("ex-adv-extra" in `v2/export/sections/batch.jsx` is an unstyled class).

## Open
1. **Conflict with 08**: 08 ak-web-hug draws the web card flat (Width · Height · Layout · Fill · Other widths, W·H and Clip under Advanced). The lead's brief for this round asked for 14's, so 08 ak-web-hug now differs from 08 on purpose. One isolated commit (`71ff22fc0`) — revert it to go back.
2. Digital (fixed-size) card per 14 ed-ab-arrange / -tidy: Preset · Position · Size, Fill ▸ Background (still 08's Size · W·H · Fill).
3. Live inspector during an artboard resize (Preset follows the drag): needs a canvas→shell `dgn` message (shared `bridge/dgn-protocol.ts` + the shell consumer) — patch request in the hand-back.
4. Padding is two lines in the 264 card (H / V chips do not fit one row); Corners shows "999 Bind" because the fixture's system has no radius token; Type "Size · weight" weight select overlaps the size field at this width; Instance Variant flyout + override dots; Export "This object" row (09 owns the Export section's shape).
5. Guides with "80" chips, Tidy-up preview/tip, lifted card with slot — not touched (fixture geometry, see c3-inspect open #4).

## Decisions
- `decision:maude/v2-p8-c5-web-card-per-14`: a web page's card follows 14 ed-ab-select (Preset, Size W·H, Clip content, Fill ▸ Background, Layout ▸ Content, Other widths last) as the lead asked; 08's kind rows remain for fixed size, video, print. Rejected: keeping 08's flat web card (the lead's brief), a context switch between the two cards.
- `decision:maude/v2-p8-c5-artboard-no-uses`: an artboard card draws no "Uses <system>" line (14 draws it for objects only).
- `decision:maude/v2-p8-c5-export-owned-by-09`: the inspector's Export section keeps 09's rows (sizes, Export N files, Copy as PNG); 14's single "PNG · 2×" row is a mock of it.
