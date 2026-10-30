# critic-final — 08 Artboard Kinds · FINAL (stage D2, d3881fe41)

One critic, four lenses. Spec dark = host re-theme (not drawn); dark judged against the app's dark tokens. (fixture) differences are not blockers. Pairs: `full-size-path.txt` last line.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ak-picker | L, D | match | Recent row absent / no ghost frame = history + hover state (fixture); icons laptop/picture/play-frame, chevrons, resting search, rhythm, placement over the toolbar all match |
| ak-picker-full | L, D | match | Print grid scrolls inside the 900 px panel (Business card / Custom row clipped in the pair); the Custom state is shown by the extra frame ak-picker-custom (Custom lit, island beside the picker). Explainer card is board-only |
| ak-web-hug | L, D | differs | design: inspector row ORDER is Width, Height, Other widths, Fill, Layout (board: Width, Height, Layout, Fill, Other widths); "+ 373 px" growth tag and "new section" highlight not shown (cannot confirm: insert-section not driven). owner `client/v2/inspector/kinds/artboard-web.jsx` |
| ak-web-widths | L, D | differs | same row order as ak-web-hug; board selects the new Mobile and shows the "wider than Mobile / Fit to width" warning row (fixture content, not shown); Advanced fold sits open with Theme/Padding/Gap in the frame; toast has a check glyph where the board has the copy glyph |
| ak-social | L, D | differs (cannot confirm) | the harness selection is the inner Photo (Photo inspector: Look tiles, Background removed), not "Gameday · story"; the artboard card (Size / Fill / Safe zones / Show on canvas / Export) is not on screen, no safe-zone bands |
| ak-safe-zones | L, D | differs (cannot confirm) | same Photo selection: no bands, no floating checked "Safe zones" menu, no Show-on-canvas row in the frame; the floating menu (round 4) is not evidenced |
| ak-print-letak | L, D | match | Print guides OFF (own switch, state) with the "Follows Menu › View…" hint; Export block is Presets / Copy / Export… (09-owned); warn row first = fixture |
| ak-warnings | L, D | differs | verb "Fix size" is plain grey text under the sentence (board: accent ghost verb); "Crosses the cut" dashed outline + tag and the 2:40 video case are not in the frame (fixture lacks them: cannot confirm) |
| ak-print-view | L, D | differs | View › Advanced submenu draws as an EMPTY panel with only "Layers as a panel" visible (rows ~150 px below the panel), so "✓ Print guides" is not visible; only the selected flyer shows guides (others not drawn) |
| ak-video | L, D | differs | inspector is the generic "hype / Fixed size / Custom W6 H7" card (digital 6px × 7px), not the Video card (Size Reels, Length, Poster frame, Sound, Export MP4); timeline head/track heads are 07's (no poster flag, "Clip 1" without waveform/music, empty lanes) |
| ak-mixed-fit | L, D | differs | Layers is a docked full-height panel with Assets tab and Advanced foot (board: auto-height island); Layers prints raw DOM (div, div__remotion-player, img) under the video; no Print dim, no "N other artboards are dimmed. Show all"; ⌘0 fit not reached (47 %) |
| ak-mixed-filter | L, D | differs | canvas no longer dimmed (fixed); rows still have an empty square, not thumbnails, no 44 px rows; panel is docked with search, "Make a design system", New canvas, Trash, Advanced and an Assets tab; foot sentence pinned small |
| ak-mixed-select | L, D | differs | "2 artboards · 2 kinds" card now opens, but: Kinds row collides ("Fixed size⊘ Print" on one line, board stacks), Fill is a "Fill / Background Default" head+row (board "Fill  Mixed" swatch), no Left/Top pressed state, Export is Presets "2 files…" + Copy + Export… with the Advanced fold open showing "article" and the dev sentence "This selection has no stable element id … /design:edit" (copy blocker); extra "Tidy up" bar |
| ak-convert | L | match | dialog title, body, "Check after", keep-copy switch, Cancel / Make A6 print present; "Nothing to check." replaces the board's three check lines (fixture) |
| ak-convert | D | differs (cannot confirm) | shot caught "Checking the pictures and the cut…"; resolved dark rows never seen |
| ak-convert-after | L, D | differs | toast says "The A6 copy is beside the artboard. The artboard is unchanged." (board: "…beside the post. The post is unchanged."); no "+13 % height · Ink fill" chip, no "Unchanged" mark on the post; the A6 copy lands overlapping the neighbouring flyer; dark: selection and inspector stay on the post (Fixed size / Custom), not the A6 copy; light copy inspector has no warning rows (fixture) |
| ak-advanced | L, D | differs | fold is open but shows Theme / Padding / Gap / Clip content / Kind (card cut at Kind), not the board's Exact size / Resolution / Colour / Guides / Look and layout / "In code" snippet; board's flat Paper + Bleed·margin rows above the fold not matched |
| ak-real-print | L, D | match | chip with kind glyph + filled warn disc + size, handles; flyer content = fixture |
| ak-real-web | L, D | match | label with browser-window glyph; page content / bottom-toolbar crop (dark) = fixture / harness |
| ak-real-about | — | unreachable | a note card on the board, not an app state; drop from the fidelity set |

## Root causes still open
1. Harness selection regressed: ak-social / ak-safe-zones select the inner Photo, ak-video the generic artboard card — the kind cards (Size, Fill, Safe zones; Length, Poster, Sound) are not on screen.
2. View › Advanced submenu renders an empty panel with its rows displaced (ak-print-view).
3. Web artboard card row order (Layout, Fill, Other widths) and the growth tag / section highlight.
4. Layers still prints raw DOM children; Layers and Canvases are docked full-height panels with an Assets tab, no thumbnails, no "Show all" dim.
5. Multi-artboard card: Kinds row collision, Fill "Mixed", leaked dev sentence in Advanced.
6. Convert: toast still says "artboard"/"post" mismatch, no change chip / "Unchanged" mark, copy overlaps its neighbour, dark after-state selects the post.
7. Warnings: verb "Fix size" unstyled; Crosses-the-cut and video-length cases unevidenced.
8. Advanced fold shows the generic Theme/Padding/Gap rows, not the board's exact-size/resolution/code set.
