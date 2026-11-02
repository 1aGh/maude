# critic-final-d3 — 08 Artboard Kinds · FINAL (D3, 63592219a)

One critic, four lenses. Spec dark = host re-theme. (fixture) differences are not blockers. Checklist = critic-final.md (D2). Pairs: full-size-path.txt last line.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ak-picker | L, D | match | Recent row / ghost frame = history + hover (fixture); icons, chevrons, tile rhythm, placement match |
| ak-picker-full | L, D | match | Print grid scrolls in the 900 px panel; Custom state is ak-picker-custom; explainer card is board-only |
| ak-web-hug | L, D | differs | design: inspector row order Width, Height, Other widths, Fill, Layout (board Width, Height, Layout, Fill, Other widths); "+ 373 px" tag and "new section" highlight not shown. owner client/v2/inspector/kinds/artboard-web.jsx |
| ak-web-widths | L, D | differs | same row order; no "wider than Mobile / Fit to width" warning row (fixture); Advanced fold open in the frame (board closed); toast has a check glyph, board the copy glyph, and says "Mobile is beside Desktop" (board: two widths); dark: selection and inspector sit on Desktop 1440, not the new Mobile |
| ak-social | L, D | differs (cannot confirm) | harness selection is the inner Photo (Look tiles); the artboard card (Size, Fill, Safe zones, Show on canvas, Export) and the safe-zone bands are not on screen |
| ak-safe-zones | L, D | differs (cannot confirm) | same Photo selection: no bands, no floating checked platform menu, no Show-on-canvas row |
| ak-print-letak | L, D | match | Print guides OFF = own state with the "Follows Menu..." hint; Export Presets / Copy / Export... is 09-owned; warn row first = fixture |
| ak-warnings | L, D | differs | verb "Fix size" is plain grey text under the sentence (board accent ghost verb); the "Crosses the cut" outline + tag and the 2:40 video case are not in the frame (cannot confirm) |
| ak-print-view | L, D | match | View > Advanced flyout now draws its rows inside the panel with "Print guides" checked; extra checked "Layers as a panel", only the fixture's two print artboards show guides; menu rows outside Advanced are 11-owned |
| ak-video | L, D | differs | inspector is the generic "hype / Fixed size / Custom W 6 H 7 / digital 6px 7px" card, not the Video card (Size Reels, Length, Poster frame, Sound, Export MP4); timeline is the compact 07 head with "Clip 1", no poster flag, empty lanes, no waveform |
| ak-mixed-fit | L, D | differs | Layers is a docked full-height panel with an Assets tab and an Advanced foot (board: auto-height island); Layers prints raw "Frame / Image" DOM children; canvas not dimmed, no "N other artboards are dimmed. Show all"; filter is All 6 not Print 2 (fixture) |
| ak-mixed-filter | L, D | differs | panel is now a hugging island, but still has Search, an Assets tab and an Advanced foot (board: none); rows are grouped ("Matchday 2 of 6" + "Print 2 of 2") not one row per canvas with project subtitle; Print row has no thumbnail in light |
| ak-mixed-select | L, D | differs | Kinds row on one line (board stacks); Fill is "Background  Mixed" under a Fill head (board: "Fill  Mixed" swatch row); no Left/Top pressed state; Export "Presets 2 files..." + Copy + Export... with the Advanced fold open; extra "Tidy up" bar |
| ak-convert | L, D | match | dialog title, body, "Check after", keep-copy switch, Cancel / Make A6 print; "Nothing to check." replaces the three check lines (fixture); dark now resolved |
| ak-convert-after | L, D | differs | toast says "beside the artboard. The artboard is unchanged." (board "post"); no "+13 % height - Ink fill" chip, no "Unchanged" mark; A6 copy lands overlapping neighbouring flyers; dark: selection/inspector stay on the source (Fixed size, Custom 432x540), not the A6 copy; light inspector has Advanced open |
| ak-advanced | L, D | differs | fold shows Theme / Follow chrome / Clip content / Kind (card cut at Kind), not Exact size / Resolution / Colour / Guides / Look and layout / "In code"; above-fold Paper + Bleed/margin rows differ from the board's flat rows |
| ak-real-print | L, D | match | label chip with kind glyph + filled warn disc + size, handles; flyer content = fixture |
| ak-real-web | L, D | match | label with browser-window glyph; page content = fixture; dark bottom-toolbar crop = harness |
| ak-real-about | — | unreachable | a note card on the board, not an app state |

## Root causes still open
1. Harness selection: ak-social / ak-safe-zones select the inner Photo, ak-video the generic artboard (kind cards never on screen).
2. Web artboard card row order (Layout, Fill, Other widths) and growth tag / section highlight.
3. Layers / Canvases panels: Assets tab, Advanced foot, raw DOM children, no Show-all dim, grouped rows.
4. Multi-artboard card: Kinds row on one line, Fill "Mixed" row, no pressed state, Tidy up bar.
5. Convert-after: toast words, no change chip / Unchanged mark, copy overlaps neighbour, dark selects the source.
6. Warn verb "Fix size" unstyled; Crosses-the-cut and video-length warnings unevidenced.
7. Advanced fold lacks exact size / resolution / guides / In code.
8. ak-web-widths: dark selection on Desktop, open fold, check-glyph toast.
