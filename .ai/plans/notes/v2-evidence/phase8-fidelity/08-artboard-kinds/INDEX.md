# Phase 8 fidelity — 08 Artboard Kinds (stage A evidence)

Branch p8-fid-g3 from feat/maude-v2 6d780ab1b. SPEC = the board artboard rendered from a scratch copy of this repo's .design (capture origin, camera pinned to 100%; the Stage's note strip is cropped off the pair for 1440×900 stages). IMPL = the release-built v2 client in Playwright Chromium (1440×900 viewport) with a window.__TAURI__ stub, throwaway HOME/XDG, claude stubbed signed-out.

**Themes.** None of 07/08/09 draws a dark artboard: every artboard is a light-pinned `<Stage>`. The "dark" SPEC half is the same board with the host's dark tokens applied (the canvas shell re-themes un-pinned artboards by default), so it is NOT a designed dark state; judge dark IMPL against the app's own dark tokens, not against it.

**Fixtures (impl).** The spec boards are drawn on the Alligators brand canvases. The impl side uses the e2e fixture project + this repo's Alligators Recruiting Trailer (24-beat real cut) + a small mixed-kind "Matchday" canvas (social post+story, web page, 2 print A6, 16:9 video) made for this pass. So content, artboard counts (6 vs 21) and canvas counts (13 vs 93) differ by construction, and the video fixtures' footage is absent ("Missing — no device has it"). (fixture) marks a difference caused only by that.

Pair image: `08-artboard-kinds/<id>-<theme>.jpg` (spec left, impl right; label strip "<id> · <theme>"). Full size: see full-size-path.txt.

| artboard id | theme | state | how reached | impl reachable? | first-glance differences |
|---|---|---|---|---|---|
| ak-picker | light | F — pick what you’re making | click the canvas, press F: the size picker | yes | Spec: picker with a Recent row (FB event cover · Post 4:5 · A6) and a ghost frame being drawn; filled grey tile icons, selected tile blue. Impl: picker floats centre-left, no Recent row, hairline tile icons and taller tiles; group badges (Fixed size / Grows as you add / mm, with bleed / Has a timeline) present in both. |
| ak-picker | dark | F — pick what you’re making | click the canvas, press F: the size picker | yes | as light (spec dark = host re-theme, not drawn) |
| ak-picker-full | light | All sizes, the four kinds, a custom print size | size picker › Print › All | yes | Spec: picker with Print expanded to all 7 + a Custom print size dialog (Width/Height/Orientation/Bleed/Safe margin) and an explainer card. Impl: Print expanded in place (Fewer ⌃) with the Custom size… tile; the dialog is a separate frame (ak-picker-custom in shots-2); explainer card is board-only. A2 tile is highlighted by keyboard focus. |
| ak-picker-full | dark | All sizes, the four kinds, a custom print size | size picker › Print › All | yes | as light (spec dark = host re-theme, not drawn) |
| ak-web-hug | light | A web page grows with its content | select the web artboard (Nábor · web) | yes | Spec: web page 1440 wide selected with growth tag "+ 373 px" and a section highlight "Rozpis zápasů · new section"; inspector Width Desktop·1440, Height Fits content/Fixed, "1573 now — grows as you add", Layout "Top to bottom", Other widths [Add a width]. Impl: Nábor · web (Tablet · 834), "1002 now — grows as you add", Other widths is a native select "Add a width…"; no growth tag, no section highlight, Layout shows Content "Page flow". |
| ak-web-hug | dark | A web page grows with its content | select the web artboard (Nábor · web) | yes | as light (spec dark = host re-theme, not drawn) |
| ak-web-widths | light | Duplicate at another width | web artboard selected, inspector open | partially — the Add a width / Other widths row was not driven; only the selected web artboard | Same frame as ak-web-hug — the "Add a width…" menu and sibling width artboards were not driven. |
| ak-web-widths | dark | Duplicate at another width | web artboard selected, inspector open | partially — the Add a width / Other widths row was not driven; only the selected web artboard | as light (spec dark = host re-theme, not drawn) |
| ak-social | light | Matchday post and story | select the story artboard | yes | Spec: post + story, inspector "Gameday · story", Size "Story 9:16 (still)" + W/H, Fill token "Ink 100%", Safe zones Instagram story, Show on canvas, Export PNG·1×; safe-zone bands drawn on the story. Impl: story selected, Size says "Custom" (a 304×540 story is not recognised as a preset), Fill None, Safe zones None, Export as 1× / PNG row + "Export 1 file"; no bands. |
| ak-social | dark | Matchday post and story | select the story artboard | yes | as light (spec dark = host re-theme, not drawn) |
| ak-safe-zones | light | Safe zones, close up | story selected, Safe zones → Instagram story | partially — inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays | Spec artboard is an explainer (two stories + a profile-grid crop + platform menu). Impl: Instagram story selected in the safe-zones select draws hatched bands with "Profile and progress bar" on the story + a Show-on-canvas switch; the platform list is a native select, not a floating list with checks. |
| ak-safe-zones | dark | Safe zones, close up | story selected, Safe zones → Instagram story | partially — inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays | as light (spec dark = host re-theme, not drawn) |
| ak-print-letak | light | A6 flyer — the inspector speaks mm | select the A6 print artboard | yes | Spec: A6 flyer inspector — Paper A6, Size in mm 105×148, Orientation, Bleed 3 mm, Safe margin 5 mm, Print guides ON, Colour note, Export "Print PDF". Impl: same rows present, plus a warning "1 px wider than A6 with bleed (419 × 581)" + Fix size (fixture-driven), Print guides OFF with "Follows View › Advanced › Print guides". Inputs look like native fields vs spec pills. |
| ak-print-letak | dark | A6 flyer — the inspector speaks mm | select the A6 print artboard | yes | as light (spec dark = host re-theme, not drawn) |
| ak-print-view | light | Print guides from View, next to the web page | palette: print guides | partially — toggled through the command palette; the board opens Menu › View › Advanced | Spec: View › Advanced menu open with "✓ Print guides" and pink bleed outlines around four print artboards beside a web page. Impl: guides toggled via the command palette; only the selected A6 shows a thin red guide frame; the menu itself was not opened. |
| ak-print-view | dark | Print guides from View, next to the web page | palette: print guides | partially — toggled through the command palette; the board opens Menu › View › Advanced | as light (spec dark = host re-theme, not drawn) |
| ak-video | light | A video artboard summons the timeline | select the video artboard | yes | Spec: Reels selected, compact timeline with poster flag, thumbnails, waveform, small floating inspector. Impl: 16:9 video artboard on the mixed canvas, timeline island overlapping the web page, full docked inspector, a single "Clip 1" without thumbnails/waveform. |
| ak-video | dark | A video artboard summons the timeline | select the video artboard | yes | as light (spec dark = host re-theme, not drawn) |
| ak-mixed-fit | light | ⌘0 fits all — Layers filters by kind | ⌘0, Layers tab | partially — a 7-artboard mixed canvas, not 21 | Spec: ⌘0 fit of 21 artboards (7%), Layers chips "All 21 · 19 · 0 · Print 2 · 0", dimmed others, "19 other artboards are dimmed. Show all". Impl: 6 artboards (fixture), Layers is a per-artboard tree with kind chips and expanded DOM children (div / div__remotion-player / img) under the video; no dimming. |
| ak-mixed-fit | dark | ⌘0 fits all — Layers filters by kind | ⌘0, Layers tab | partially — a 7-artboard mixed canvas, not 21 | as light (spec dark = host re-theme, not drawn) |
| ak-mixed-filter | light | Canvases filtered by kind | Canvases panel, kind chip: Print | partially — 13 canvases not 93 | Spec: Canvases filtered Video 12 of 93, rows with thumbnails and "2 of 3" badges, footer "12 of 93 canvases have video". Impl: Print chip → "Matchday 2 of 6", "Print 2 of 2", footer "2 of 13 canvases have print…"; no row thumbnails; non-matching artboards are faded on the canvas (spec leaves the canvas undimmed). |
| ak-mixed-filter | dark | Canvases filtered by kind | Canvases panel, kind chip: Print | partially — 13 canvases not 93 | as light (spec dark = host re-theme, not drawn) |
| ak-mixed-select | light | Two kinds selected | ⌘A selects every artboard | yes | Spec: two artboards → inspector "2 artboards · 2 kinds" (Kinds list, Fill Mixed, align H/V, Export "2 files…"). Impl: ⌘A → 3 objects, a context toolbar "3 objects" with align buttons floats under the print artboard; the right inspector panel did not open. |
| ak-mixed-select | dark | Two kinds selected | ⌘A selects every artboard | yes | as light (spec dark = host re-theme, not drawn) |
| ak-convert | light, dark | 13 · Post 4:5 → A6 print | — | **no** — the Make-an-A6-print dialog did not open from the Size select in this pass (select options not matched); reachable in principle via the inspector Size select — needs a follow-up | spec only: `ak-convert-light-spec-only.jpg` |
| ak-convert-after | light, dark | 14 · After — the post stays, the A6 copy sits beside it | — | **no** — depends on ak-convert | spec only: `ak-convert-after-light-spec-only.jpg` |
| ak-warnings | light | Warnings — one place, one verb | print artboard selected (label mark + inspector line) | partially — same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box | Spec: one place for warnings (label mark + inspector row + one verb). Impl frame equals ak-print-letak: label warning triangle + inspector row "1 px wider than A6 with bleed (419 × 581)" with a Fix size button — the one-verb shape exists; the board multi-warning cases were not reproduced. |
| ak-warnings | dark | Warnings — one place, one verb | print artboard selected (label mark + inspector line) | partially — same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box | as light (spec dark = host re-theme, not drawn) |
| ak-advanced | light | Advanced — exact values and the code | print artboard, inspector Advanced fold | yes | Spec: the inspector open at 100% zoom on the flyer with the Advanced fold expanded — Exact size (artboard/trim/bleed·margin px), Resolution (canvas 96 ppi, print PDF 300 dpi), Colour note, Guides, Look and layout (Theme, Body layout, Grid tracks, Layout), "In code" snippet. Impl: the Advanced fold did NOT open (the click missed) — the frame is the collapsed print inspector ("Advanced · 7 properties"); fold content not captured. |
| ak-advanced | dark | Advanced — exact values and the code | print artboard, inspector Advanced fold | yes | as light (spec dark = host re-theme, not drawn) |
| ak-real-about | light, dark | 17 · About the next two | — | **no** — a note card on the board, not an app state | spec only: `ak-real-about-light-spec-only.jpg` |
| ak-real-print | light | A · přední (FLAG) — real print artboard | the real print artboard in the canvas, cropped | partially — the fixture’s print artboard, not the Alligators flyer | (fixture) Spec: the real navy flyer with logo + QR + copy. Impl: the e2e fixture's plain green A6 (title + white box) with chip "A · přední (FLAG) ⚠ 105 × 148 mm" and handles. Content difference is the fixture, not the app. |
| ak-real-print | dark | A · přední (FLAG) — real print artboard | the real print artboard in the canvas, cropped | partially — the fixture’s print artboard, not the Alligators flyer | as light (spec dark = host re-theme, not drawn) |
| ak-real-web | light | Nábor FLAG — real web artboard (hug) | the real web artboard in the canvas, cropped | partially — the fixture’s web artboard, not the Alligators page | (fixture) Spec: Nábor web page, dark. Impl: fixture web page with a green hero, cropped by the window edge because the hugged page is taller than the viewport. |
| ak-real-web | dark | Nábor FLAG — real web artboard (hug) | the real web artboard in the canvas, cropped | partially — the fixture’s web artboard, not the Alligators page | as light (spec dark = host re-theme, not drawn) |

## Coverage

- artboards on the board: 19
- pair images (id × theme): 32
- artboards with no impl frame (spec-only): 3 — ak-convert, ak-convert-after, ak-real-about

## After — stage C round 2 (p8-c2-insptl)
Pairs in this folder were re-shot light + dark on branch p8-c2-insptl (spec left, impl right). Per artboard id × theme: see `fix-insptl.md` (08 table). Changed this round: ak-video (Length well, Sound note), ak-advanced (fold open in the frame). Everything else is the wave-1 state.

## After (stage D, 6d19daa9a) — p8-d-g3

Re-shot on the stage C round 2 tip (feat/maude-v2 6d19daa9a), release-built client, 1440×900 Chromium, throwaway HOME/XDG, claude stubbed signed-out. No product code touched. Evidence only — match / mismatch is judged by the critic re-check. Pairs: `<id>-<theme>.jpg` here (spec left, impl right); full size: `full-size-path.txt`.

**SPEC side: reused.** `.design/ui/v2/08 Artboard Kinds.{tsx,css}` has no commit since the stage A shot, so the stage A spec PNGs were copied over unchanged.

**IMPL side, per artboard id × theme (light, dark):**

| artboard id | after (stage D) |
|---|---|
| ak-picker, ak-picker-full, ak-web-hug, ak-web-widths, ak-social, ak-safe-zones, ak-print-letak, ak-print-view, ak-video, ak-mixed-fit, ak-mixed-filter, ak-mixed-select, ak-warnings, ak-advanced, ak-real-print, ak-real-web | re-shot, light + dark (Matchday mixed-kind canvas; ak-real-* on the real Print / Web canvases) |
| ak-convert, ak-convert-after | re-shot, light + dark — NEW this stage (spec only in stage A). Reached through the inspector Size select (`insp-ab-preset`, value `paper:a6`) on the post: ak-convert = the "Make an A6 print?" dialog; ak-convert-after = after "Make A6 print" |
| ak-real-about | unreachable — a note card on the board, not an app state. Spec only (stage A shot stays) |

Extra frame: `ak-picker-custom` (the picker with a custom-size state) is shot into the impl folder only; it has no board artboard of that id, so no pair was made.

Harness notes: the What's New panel opens over a fresh project and is now closed by `run.mjs` before shooting. Scenario `t08.mjs` unchanged from stage A.

## After (round 4, p8-c4-kindsexport) — size picker, inspector slots, convert, kind-dim, warn outlines

Re-shot light + dark with the committed stage-D harness (`_d-harness-g3`, t08 now waits for the convert dialog's "Check after" list to resolve — it takes ~3 s, the stage-D shot at 1.8 s caught "Checking…"; not a product bug). Pairs overwritten in this folder.

| artboard id | after (round 4) |
|---|---|
| ak-picker, ak-picker-full | App head = laptop, Social head = picture, Video head + tile = frame with a play mark (not the phone / camera); "Grows as you add" and "Fewer" chevrons point down; search rests on bg-3 (30 px, accent ring only once something is typed); Custom size… keeps the picker open with the Custom tile lit and the mm island BESIDE it |
| ak-picker-custom | re-shot (extra frame) — the island beside the open picker |
| ak-web-hug, ak-web-widths | Fill is a row ("Fill  None") and Layout one row ("Layout  Top to bottom") in the one Artboard card — no section heads; Padding / Gap moved under Advanced. Add-a-width menu / sibling boards still not driven |
| ak-social, ak-safe-zones | the safe-zone platform list is the floating checked menu (head, check column, rule, footnote); the platform notes left the card (row tooltip); Fill row |
| ak-print-letak, ak-warnings | Paper reads "A6" (not "A6 · 105 × 148 mm"), no drag grip on Bleed / Safe margin |
| ak-convert, ak-convert-after | the dialog is shot once its list resolved; after "Make A6 print" the new A6 copy is SELECTED (Print inspector: Paper A6, Made from, warnings) and the toast is one line with the copy glyph |
| ak-mixed-filter | the Canvases chip no longer dims the open canvas (only a Layers pick does) |
| ak-warnings | the layer a cut warning names carries a dashed warn outline + "Crosses the cut" tag (canvas, edit chrome only; the fixture's flyer has no layer across the cut, so the shot shows the label marks only) |
| ak-real-print, ak-real-web | unchanged (matched in stage D) |

## FINAL (stage D2, d3881fe41) — p8-d2-g3

Every reachable id re-shot on the merged tip (release-built client, Google Chrome channel for H.264, light + dark), IMPL side only; spec frames reused from stage D (the board .tsx files and .design are byte-identical to the stage-D copy: `git diff 6d19daa9a HEAD -- .design` is empty). No match/mismatch judged here. Pairs: full-size-path.txt (last line).

| artboard id | light | dark |
|---|---|---|
| ak-picker | re-shot | re-shot |
| ak-picker-full | re-shot | re-shot |
| ak-web-hug | re-shot | re-shot |
| ak-web-widths | re-shot (Desktop and Mobile added beside the 834 page; the menu itself is closed) | re-shot (Desktop and Mobile added beside the 834 page; the menu itself is closed) |
| ak-social | re-shot | re-shot |
| ak-safe-zones | re-shot (inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays) | re-shot (inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays) |
| ak-print-letak | re-shot | re-shot |
| ak-print-view | re-shot (Menu › View › Advanced › Print guides, opened again after the toggle so the checked row shows) | re-shot (Menu › View › Advanced › Print guides, opened again after the toggle so the checked row shows) |
| ak-video | re-shot | re-shot |
| ak-mixed-fit | re-shot (a 7-artboard mixed canvas, not 21) | re-shot (a 7-artboard mixed canvas, not 21) |
| ak-mixed-filter | re-shot (13 canvases not 93) | re-shot (13 canvases not 93) |
| ak-mixed-select | re-shot | re-shot |
| ak-convert | re-shot | re-shot |
| ak-convert-after | re-shot | re-shot |
| ak-warnings | re-shot (same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box) | re-shot (same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box) |
| ak-advanced | re-shot | re-shot |
| ak-real-about | unreachable — a note card on the board, not an app state | unreachable — a note card on the board, not an app state |
| ak-real-print | re-shot (the fixture’s print artboard, not the Alligators flyer) | re-shot (the fixture’s print artboard, not the Alligators flyer) |
| ak-real-web | re-shot (the fixture’s web artboard, not the Alligators page) | re-shot (the fixture’s web artboard, not the Alligators page) |

Totals: 36 id×theme re-shot, 2 unreachable (spec-only frames kept from stage A/D).

Harness notes (D2): ak-convert / ak-convert-after select the post by clicking its LABEL chip (a click on the picture selects the photo inside it), wait up to 30 s for the "Check after" list (it read "Nothing to check." in the shots; once, under load, it answered "The pictures and the cut can’t be checked right now.") and wait 9 s for the A6 copy to land; the convert runs LAST so its extra artboard does not move the other crops. New this round: ak-mixed-select = shift-click of two artboard labels (2 artboards, 2 kinds), ak-advanced opens the inspector fold (`fold-inspector-toggle`), ak-web-widths drives Other widths > Add a width (Desktop + Mobile), ak-print-view opens Menu > View > Advanced (Print guides toggled on first). **Observation for the critic:** in the ak-print-view frame the View > Advanced submenu draws as an empty white panel with only the focused row ("Layers as a panel") visible; the submenu rows are laid out ~150 px below its panel (measured: Print guides row at y 746, panel 183-607). Seen in Chrome on both themes; not harness-caused (testid click, hover and ArrowRight all give the same). `ak-picker-custom` is an extra impl frame with no board artboard (no pair).

## FINAL (D3, 63592219a) — p8-d3-g3

Every reachable id re-shot again on the merged tip after stage C round 5 + bugs3 (release-built client, Google Chrome channel, light + dark), IMPL side only. Spec frames reused from stage D (the board 08 .tsx/.css last changed in 2220acc81, before the stage-D spec shot). No match/mismatch judged here. Pairs: full-size-path.txt (last line, "final (D3)").

| artboard id | light | dark |
|---|---|---|
| ak-picker | re-shot | re-shot |
| ak-picker-full | re-shot | re-shot |
| ak-web-hug | re-shot | re-shot |
| ak-web-widths | re-shot | re-shot |
| ak-social | re-shot | re-shot |
| ak-safe-zones | re-shot (inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays) | re-shot (inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays) |
| ak-print-letak | re-shot | re-shot |
| ak-print-view | re-shot | re-shot |
| ak-video | re-shot | re-shot |
| ak-mixed-fit | re-shot (a 7-artboard mixed canvas, not 21) | re-shot (a 7-artboard mixed canvas, not 21) |
| ak-mixed-filter | re-shot (13 canvases not 93) | re-shot (13 canvases not 93) |
| ak-mixed-select | re-shot | re-shot |
| ak-convert | re-shot | re-shot |
| ak-convert-after | re-shot | re-shot |
| ak-warnings | re-shot (same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box) | re-shot (same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box) |
| ak-advanced | re-shot | re-shot |
| ak-real-about | unreachable — a note card on the board, not an app state | unreachable — a note card on the board, not an app state |
| ak-real-print | re-shot (the fixture’s print artboard, not the Alligators flyer) | re-shot (the fixture’s print artboard, not the Alligators flyer) |
| ak-real-web | re-shot (the fixture’s web artboard, not the Alligators page) | re-shot (the fixture’s web artboard, not the Alligators page) |

Totals: 36 id×theme re-shot, 2 unreachable (spec-only frames kept).

Harness notes (D3): the D2 harness (`_d2-harness-g3/`) plus the bugs3 deltas, repointed; no scenario changes were needed for the round-5 product. Observed in the frames: the View › Advanced submenu now draws its rows inside its panel (nested submenus are position:fixed — the empty-panel observation of D2 no longer shows); ak-convert-after shows the "The A6 copy is beside the artboard. The artboard is unchanged." toast with Undo. `ak-picker-custom` is an extra impl frame with no board artboard (no pair).

## FINAL (D4, 21c9714cf) — p8-d4-g3

Every reachable id re-shot again on the merged tip after stage C round 6 (release-built client, Google Chrome channel, light + dark), IMPL side only. Spec frames reused from stage D (the board 08 .tsx/.css last changed in 2220acc81, before the stage-D spec shot). No match/mismatch judged here. Pairs: full-size-path.txt (last line, "final (D3)").

| artboard id | light | dark |
|---|---|---|
| ak-picker | re-shot | re-shot |
| ak-picker-full | re-shot | re-shot |
| ak-web-hug | re-shot | re-shot |
| ak-web-widths | re-shot | re-shot |
| ak-social | re-shot | re-shot |
| ak-safe-zones | re-shot (inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays) | re-shot (inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays) |
| ak-print-letak | re-shot | re-shot |
| ak-print-view | re-shot | re-shot |
| ak-video | re-shot | re-shot |
| ak-mixed-fit | re-shot (a 7-artboard mixed canvas, not 21) | re-shot (a 7-artboard mixed canvas, not 21) |
| ak-mixed-filter | re-shot (13 canvases not 93) | re-shot (13 canvases not 93) |
| ak-mixed-select | re-shot | re-shot |
| ak-convert | re-shot | re-shot |
| ak-convert-after | re-shot | re-shot |
| ak-warnings | re-shot (same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box) | re-shot (same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box) |
| ak-advanced | re-shot | re-shot |
| ak-real-about | unreachable — a note card on the board, not an app state | unreachable — a note card on the board, not an app state |
| ak-real-print | re-shot (the fixture’s print artboard, not the Alligators flyer) | re-shot (the fixture’s print artboard, not the Alligators flyer) |
| ak-real-web | re-shot (the fixture’s web artboard, not the Alligators page) | re-shot (the fixture’s web artboard, not the Alligators page) |

Totals: 36 id×theme re-shot, 2 unreachable (spec-only frames kept).

Harness notes (D4): the D3 harness (`_d3-harness-g3/`) plus the round-6 mini scenarios (`t08c`/`t09c`, for reference; the full `t08` was run and needed no scenario changes), repointed to worktree wf_74ac1088-f6f-11 (branch p8-d4-g3, tip 21c9714cf), Google Chrome channel, release-built client. Spec frames reused unchanged (the `08` board last changed on 2026-10-22 or earlier, before the stage-D spec shots). The extra frame ak-picker-custom has no spec and no committed pair.

## Round 6 (p8-c6-bugs4) — after

| id | after | notes |
|---|---|---|
| ak-convert-after | re-shot, light + dark | mini scenario `t08c` (the post → A6 convert only). The toast now says "The A6 copy is beside the post. The post is unchanged." (an artboard labelled "post" is a post, not only a catalogue size); the A6 copy is selected in both themes. Still open: the "+ 13 % height · Ink fill" chip and the "Unchanged" mark under the post (a transient canvas overlay that needs a new dgn message — see `10-share-and-collaboration/fix-c6-bugs4.md`) |

## Round 7 (p8-c7-cf08) — after

Re-shot light + dark with the round-7 harness (`_c7-harness-g3/t08.mjs`: the artboard is selected by its label chip; ak-web-hug grows the page; ak-mixed-fit presses the Print chip in Layers; ak-advanced scrolls the fold). Fix list: `01-create-flow/fix-c7-cf08.md`.

| id | after (round 7) |
|---|---|
| ak-web-hug, ak-web-widths | the card reads Width · Height · Layout · Fill · Other widths; the web page itself is selected (the growth tag sits right of the page, under the inspector in this crop) |
| ak-social, ak-safe-zones, ak-video | the ARTBOARD is selected (label chip), so the artboard card / Video card show, not the inner photo's |
| ak-advanced | the print fold leads with Exact size · Resolution · Colour · Guides (Look and layout with Theme, then In code, follow below inside the fold's own scroll) |
| ak-mixed-fit | the Print chip on in Layers (the canvas dims, "N other artboards are dimmed · Show all" foot) |
| ak-mixed-select | one flat card: Kinds · Fill (swatches + Mixed) · Horizontal · Vertical (Top pressed) · note · Export; no floating align bar |
| ak-convert-after | the canvas draws "✓ Unchanged" under the post and "+ N % height · Ink fill" on the copy (convert-marks) |
| others | re-shot, unchanged by this round |

## Round 7b (p8-c7-cf08b) — after

Harness `_c7b-harness-g3/` (t08 on top of `_c7-harness-g3/`). Re-shot light + dark. Fix list: `01-create-flow/fix-c7-cf08b.md`.

| id | after (round 7b) |
|---|---|
| ak-web-hug | the board is panned left first; "Rozpis zápasů · new section" frames the section that arrived and "+ 156 px" sits right of the page (both screen-sized at any zoom, not under the inspector) |
| ak-advanced | the print fold's Look and layout block is in view: Theme · Body layout · Grid tracks (Edit tracks…) · Layout (Convert to absolute…) |
| ak-mixed-fit | the Print chip is really on (Layers' own chip): the canvas dims, "N other artboards are dimmed. Show all" foot; unnamed Frame / Image rows of the video artboard stay (the fixture's picture is a hash file name; text rows read their words, see 01 cf-duplicate-done) |
| others | re-shot, unchanged by this round |

## FINAL (D5, e37e7d82a) — p8-d5-g3

Final verification shoot after stage C round 7, on the merged tip (release-built client, Google Chrome channel, Mac mini, light + dark), IMPL side only; spec frames reused unchanged from D4. Harness `_d5-harness-g3/` (`chain.sh 08` = `t08`, the round-7b version: label-chip selection, ak-web-hug pans before the page grows, ak-mixed-fit presses the Layers panel's own chip, ak-advanced scrolls the card and the fold to their ends). Shot at `0ef942d45` (= tip + the D5 harness only). No match judged here.

| artboard id | light | dark |
|---|---|---|
| ak-picker, ak-picker-full | re-shot | re-shot |
| ak-web-hug | re-shot (a section is added to Matchday.tsx so the growth tag shows) | re-shot (same) |
| ak-social, ak-safe-zones, ak-print-letak, ak-warnings, ak-video | re-shot | re-shot |
| ak-advanced | re-shot (card + fold scrolled to the end) | re-shot (same) |
| ak-mixed-fit, ak-mixed-filter, ak-mixed-select | re-shot | re-shot |
| ak-real-print, ak-real-web | re-shot | re-shot |
| ak-print-view | re-shot (Menu › View › Advanced, Print guides on) | re-shot (same) |
| ak-web-widths | re-shot (Other widths › Add a width, Desktop + Mobile) | re-shot (same) |
| ak-convert, ak-convert-after | re-shot (the convert runs last) | re-shot (same) |
| ak-real-about | unreachable — a note card on the board, not an app state; spec-only frame stands | unreachable (same) |
| ak-picker-custom (extra impl frame, no board artboard) | shot into impl only, no spec, no pair | shot into impl only, no pair |

Totals: 36 id×theme re-shot (18 ids), 2 unreachable (1 id). The committed `ak-convert-light-spec-only.jpg` / `ak-convert-after-light-spec-only.jpg` are stale (both ids are pairs since D2).

## Round 8 (p8-c8-misc2) — re-shot, light + dark (harness `_c8m2-harness-g3`, scenario `t08m`)

| artboard id | after (round 8) |
| --- | --- |
| ak-web-widths | re-shot: the tallest of the three widths selected; the Height note reads "N now — the longest of the three." (`webLongestOf`, dom-selection.ts: the sibling web pages in the same section at distinct widths) |
| ak-safe-zones | re-shot: the zone is APPLIED (the Safe zones row is a select-shaped button opening a checked menu — `insp-safe-zones` / `insp-safe-zones-instagram-reels`; the D5 harness drove a native `<select>` that no longer exists): bands + tags on the artboard, the Show on canvas row in the inspector. The menu itself is not shot (a side state: it is cut off at the card's foot) |
| ak-mixed-fit | re-shot: Print chip on, the list names only the two print artboards under the canvas name, the dimmed line is the foot of the panel |
| ak-mixed-filter | re-shot: the kind filter is ONE store shared by Layers and Canvases — the D5 harness pressed Print in Layers and again in Canvases, which toggled it off; the chip is cleared first now, so the Canvases panel shows the filtered list, hit counts and the foot "N of M canvases have print" |

## FINAL (D6, 3d58f57df) — p8-d6-g3

Final verification shoot after stage C round 8, on the merged tip feat/maude-v2 3d58f57df (release-built client, Google Chrome channel, Mac mini, light + dark), IMPL side only; spec frames reused unchanged (08 board unchanged since 2220acc81, before the D4 spec shots). Shot at 873574992 = tip + the D6 harness only. Harness `_d6-harness-g3/` (`chain.sh 08` = `t08` the full id set from `_c8m2-harness-g3`, then `t08m` which re-shoots the four round-8 ids with their round-8 states: ak-safe-zones (select-shaped Safe zones button + checked menu), ak-mixed-fit (Layers names only the pressed kind; "N other artboards are dimmed. Show all" foot), ak-mixed-filter (kind filter cleared before the Canvases chip), ak-web-widths (Height note "N now — the longest of the three")). Committed `<id>-<theme>.jpg` pairs overwritten.

| artboard id | light | dark |
|---|---|---|
| ak-picker, ak-picker-full | re-shot | re-shot |
| ak-web-hug | re-shot (a section is added to Matchday.tsx so the growth tag shows) | re-shot (same) |
| ak-social, ak-print-letak, ak-warnings, ak-video | re-shot | re-shot |
| ak-safe-zones | re-shot (t08m, round-8 state) | re-shot (same) |
| ak-advanced | re-shot (card + fold scrolled to the end) | re-shot (same) |
| ak-mixed-fit, ak-mixed-filter | re-shot (t08m, round-8 states) | re-shot (same) |
| ak-mixed-select | re-shot | re-shot |
| ak-real-print, ak-real-web | re-shot | re-shot |
| ak-print-view | re-shot (Menu › View › Advanced, Print guides on) | re-shot (same) |
| ak-web-widths | re-shot (t08m: Other widths › Add a width, the added widths beside Desktop; the tallest board selected) | re-shot (same) |
| ak-convert, ak-convert-after | re-shot (the convert runs last) | re-shot (same) |
| ak-real-about | unreachable — a note card on the board, not an app state; spec-only frame stands | unreachable (same) |
| ak-picker-custom (extra impl frame, no board artboard) | shot into impl only, no spec, no pair | shot into impl only, no pair |

Totals: 36 id×theme re-shot (18 ids), 2 unreachable (1 id). Still open per `fix-c8-misc2.md`: ak-advanced Grid tracks / Convert to absolute drawn disabled; the Safe zones menu is cut off at the card foot when the card has little under the row.
