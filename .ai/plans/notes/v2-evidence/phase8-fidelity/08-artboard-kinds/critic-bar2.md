# critic-bar2 — 08 Artboard Kinds · verified bar, FINAL (D4, 21c9714cf)

Judged fresh from the D4 pairs (both themes). Checklist = critic-final-d3.md. Lead decisions applied: owning board wins (web card per 08, inspector per 14), toast dock/top rule, export slot 09/14-owned, menu structure 11-owned.

## Verdicts
- ak-picker · verified (L+D) · none
- ak-picker-full · verified (L+D) · none (Custom size form is its own side row)
- ak-web-hug · differs · inspector row order (board: Width, Height, Layout, Fill, Other widths; ours Other widths, Fill, Layout); "+ 373 px" growth tag and "new section" highlight not drawn
- ak-web-widths · differs · same row order; board's "wider than Mobile / Fit to width" warning row not on screen (fixture: no 960 px layer)
- ak-social · differs (unconfirmed) · harness still selects the inner Photo, so the artboard card (Size, Fill, Safe zones, Show on canvas, Export) and the safe-zone bands are not on screen
- ak-safe-zones · differs (unconfirmed) · same Photo selection: no bands over the artboards, no floating checked platform menu
- ak-print-letak · verified (L+D) · none (Print guides OFF = state; Export slot 09-owned)
- ak-warnings · verified (L+D) · none (paper-size case shown with label mark + one inspector row + verb; other two cases are side rows)
- ak-print-view · verified (L+D) · none (View > Advanced flyout with Print guides checked; menu structure 11-owned)
- ak-video · differs · selected video artboard shows the generic "hype / Fixed size / Custom W 6 H 7" card, not the Video card (Size, Length, Poster frame, Sound, Export MP4); label says video but kind card is wrong
- ak-mixed-fit · differs · Layers is a docked full-height panel with an Assets tab and Advanced foot (board: hugging island, two tabs); Layers prints raw "Frame / Image" DOM children; no "N other artboards are dimmed. Show all"; canvas not dimmed
- ak-mixed-filter · differs · panel keeps Search, Assets tab, Advanced foot; rows grouped ("Matchday 2 of 6" + "Print 2 of 2") not one row per canvas with project subtitle and thumbnail
- ak-mixed-select · differs · Fill is "Background · Mixed" under a Fill head (board: "Fill · Mixed" swatch row); no pressed Left / Top state; extra floating "Tidy up" bar the board does not draw; Export is Presets + Copy + Export... (09-owned) with Advanced fold open
- ak-convert · verified (L+D) · none (light shows a stale "Mobile is beside Desktop" toast behind the dialog = harness leak, polish)
- ak-convert-after · differs · board's "+ 13 % height · Ink fill" chip and "Unchanged" mark under the post are not drawn (transient canvas overlay, needs a dgn message); toast, copy selection, Print card now match
- ak-advanced · differs · fold shows Theme / Follow chrome / Clip content / Kind; board's fold is Exact size, Resolution, Colour, Guides, Look and layout, In code
- ak-real-print · verified (L+D) · none (flyer content = fixture)
- ak-real-web · verified (L+D) · none (page content = fixture; dark bottom toolbar crop = harness)
- ak-real-about · unreachable · a note card on the board, not an app state

## Polish list
- ak-picker · Recent chips row absent (history, fixture); video tile glyphs differ in detail; tile rhythm 115/86 vs 128/91 (within crop tolerance)
- ak-picker-full · Print grid scrolls inside the 900 px panel, Custom tile partly cut (scroll); explainer card is board-only
- ak-print-letak · Print guides OFF with "Follows Menu > View > Advanced > Print guides." hint (board ON); warn row first (fixture 1 px)
- ak-warnings · "Fix size" verb is plain grey text, board uses the accent ghost verb (colour/token, control still present)
- ak-print-view · extra checked "Layers as a panel"; only fixture print artboards show guides
- ak-convert · "Nothing to check." replaces the three check lines (fixture); stale toast in light
- ak-convert-after · A6 copy lands overlapping neighbours (fixture layout); Advanced fold open; extra Export block (09)
- ak-web-widths · Advanced fold open ("kept open"); toast says "Mobile is beside Desktop" (one width added, board two) and wears a check glyph, not the copy glyph
- ak-mixed-select · Kinds row on one line (board stacks)
- ak-mixed-fit / ak-mixed-filter · filter is All 6 / 13 canvases (fixture, board 21 / 93)
- ak-video · compact timeline head ("Clip 1", empty lanes, no poster flag, no waveform) is 07-owned

## Side states
- ak-picker-full/custom-size-form · Custom print size form (Width, Height, Orientation, Bleed, Safe margin, Cancel / Add artboard) · reachable (frame ak-picker-custom exists, no committed pair)
- ak-warnings/crosses-the-cut · QR crosses the cut: dashed outline + tag + "Move inside" row · reachable (ArtboardWarnOutlines built; needs fixture with a layer over the trim)
- ak-warnings/video-length · "2:40 long" video warning with "Allow longer" · reachable with a fixture video over 2 min (not in the e2e fixture)
- ak-safe-zones/platform-menu · floating checked platform menu with footnote · reachable once the artboard card is selected
