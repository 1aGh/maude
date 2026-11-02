# 08 Artboard Kinds — round 10 (p8-c10-print)

## Round 10 (p8-c10-print) — done / open

Done (fail-first tests `p8-c10-print-outside.test.tsx`, `v2-inspector-print.test.tsx`, `edit-layout-client.test.tsx`):
- One un-clipped print layer: `registerKindOutsideOverlay` in `artboard-guides-overlay.tsx` mounts a second `.dc-artboard-guides.dc-artboard-guides--outside` layer (same rect, no clip, hidden by every exporter through the shared class); `print-overlay-content.tsx` registers the dashed print-area outline, four crop marks and the legend "Bleed N mm · trim · safe margin M mm" (the artboard's own numbers) — shown with the print guides, screen-sized at any zoom.
- 08 ak-advanced: Layout · Convert to absolute… is enabled whenever the sheet is editable and an artboard selection converts the artboard body (`layout-actions.ts` -> `__maudeConvertArtboard`).
Re-shot: ak-print-view, ak-advanced (light + dark).

Open:
- ak-advanced: Grid tracks · Edit tracks… stays disabled (no print-board track editor; DDR-186's editor is element-level).
- ak-print-view: the board itself draws no legend on this artboard (only ak-convert-after and 10 co-comment-print do); the product now draws it under each sheet while the guides are on.
