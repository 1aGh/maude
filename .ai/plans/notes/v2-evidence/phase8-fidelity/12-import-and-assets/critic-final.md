# 12 Import and Assets: FINAL critic (stage D2, d3881fe41), one critic, four lenses

Sources: the D2 pairs (`<id>-<theme>.jpg` here; full size at the "final (D2)" path in `full-size-path.txt`), INDEX "FINAL (stage D2)", stage-B reports (design, copy, a11y, signature), `fix-assets.md`, and my earlier `critic-d.md` as a checklist. Every reachable id was judged fresh in both themes. Lead decisions applied: contract over board, "From this Mac…" row stays (v2-8.5-c9-from-this-mac-row-04-owns), Browse takes the island box, SVG-only logo import stays "SVG" (capability, warning), disabled primaries and v2 accent/buttons/sheet material are now fixed in the shots. The impl's extra top-right sliders island, "Local project" and the harness toolbar tool are canvas 14 / harness, not counted. Fixture content (plasma JPEGs, 19 photos, no video/sound/logos/generated) is not a blocker.

Fixed since stage B (seen in the shots): v2 accent, kit buttons, chevrons, import sheet material (372 / 420 wide, lock and warning glyphs), All kinds chip + spark + Add on the chip row, no ⌘K in the field, library foot, two-row cap, "In the name or tags" group + match foot, search ring, soft "Not used" chip, Missing frame hatch + warning card + Relink…, details "…" + 150 px crop, drop chip names the artboard (see drop row: the shot still shows the old words), placed toast + Undo, photo inspector Photo section (Look tiles, Remove background, Replace… / Reset, Only this use changes).

## Per id

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ia-drop-photos | dark | differs | copy: chip reads "Drop to fill 6 empty frames in order", spec "Drop to place 6 photos in Fotky ze zápasu" (the board string is not what the app says on an artboard of empty frames; owner `editing/finder-drop.tsx` / `edit-ops/place-plan.ts`); left panel shows Canvases, spec shows the Assets tab; drag ghost is native (not counted) |
| ia-drop-photos | light | differs | same |
| ia-placed | dark | differs | design: the six photos are not selected as a group with the "6 photos" tag; the Frame inspector of the artboard is open instead (board: no inspector, tag on the group). Toast "Placed 6 photos in MVP zápasu. They're in Assets too." + Undo and the "Just added 6" group match; upload bars / Syncing… are data |
| ia-placed | light | differs | same |
| ia-more-ways | both | unreachable | not built: prepare-in-place clip card + "3 clips · Assemble into a video", logo-cleaned-up notice, paste entry "Screenshot · now". Needs product work, then a video/logo/paste fixture |
| ia-assets-panel | dark | match | (fixture: one group; "From this Mac…" kept by decision; spec hover tip / selected tile not shown, transient state) |
| ia-assets-panel | light | match | same |
| ia-assets-keys | dark | differs | the tile menu (Place in <artboard> ↵ / Show details ⌘I / Rename… / Copy ⌘C / Move to trash) is not in the frame and no artboard is selected, so "Place in MVP zápasu" cannot be confirmed; Rename… is still not built (needs `POST /_api/assets/rename`) |
| ia-assets-keys | light | differs | same |
| ia-assets-browse | dark | differs | design: the wide view replaces the tab row (spec keeps Canvases / Layers / Assets + panel-left icon above "‹ Assets Photos"); "N selected · size · Clear · Place N in <artboard> ↵" foot bar not shot (cannot confirm); event grouping is data. Pick circles, Large/Small ring, sort chip, day head now match |
| ia-assets-browse | light | differs | same |
| ia-assets-find | dark | differs | only state 1 of 4 shot (consent sheet, "Seen in the picture", AI-not-connected need an AI stub: cannot confirm 2-4); match-name labels missing on the first two result tiles in dark (the foot gradient shows only on the third) |
| ia-assets-find | light | differs | states 2-4 not shot (cannot confirm). State 1 itself matches (ring, "In the name or tags", match foot labels, offer card) |
| ia-assets-tidy | dark | differs | the Photos group lists all 17 tiles in tidy mode (spec caps at two rows with the count); the foot is two stacked lines ("17 assets · 2.1 MB" above "Move 17 to the trash…", the button runs off the panel bottom) where the spec is one line; "Not counted: …" banner absent (data-conditional, cannot confirm) |
| ia-assets-tidy | light | differs | same |
| ia-asset-details | dark | match | (data: unused photo, no Used-in list, no avatar, no AI-saw chips, "Place" without artboard name) |
| ia-asset-details | light | differs | Used-in rows (pic.png): cover squares render blank grey, the second line is the raw artboard label "EXPORT/01 · ARTIFACT" and the second row has none; spec shows canvas thumbs + board label. Cannot confirm covers render (`v2/assets/details.jsx` Used-in rows) |
| ia-photo-inspector | dark | differs | Placement Fill / Fit / Crop segment missing; Light / Colour rows carry an extra numeric field; "Remove background" is a plain button (spec accent-outlined); an Image / Photo tab pair the board does not draw (board 14 may own it, unconfirmed); header is the stored sha name (data) |
| ia-photo-inspector | light | differs | same |
| ia-photo-steps | dark | differs | the crop step is not reachable: no "4:5 · from the artboard" pill, no crop handles, no Fill/Fit/Crop seg with Crop active, no "The whole photo stays — only the frame moves."; Remove background, Done and the Apply-to-every-use sheet not shot (impl shows the photo section only) |
| ia-photo-steps | light | differs | same |
| ia-gen-ask | dark | differs | the ask is still the inline card in the Assets panel, not the AI chat island (header "Gameweek 5 photo ▾", mode chips, option chips, scope chip, round send button); the "4 variants" select is native-looking; red "No image provider is ready…" replaces the cost + SynthID lines; the artboard inspector is open instead of the chat island |
| ia-gen-ask | light | differs | same |
| ia-gen-placed | both | unreachable | needs a generation-provider stub or a recorded-takes fixture (`takes-overlay.jsx` exists) |
| ia-figma-sheets | dark | differs | sheets 1 and 2 match (372 wide, lock callout, words); sheet 3 (pick frames and where they go) not shot — needs a Figma API stub; accent focus ring on the link field (spec caret only) is a warning |
| ia-figma-sheets | light | differs | same |
| ia-figma-sheets-connect | dark | match | (harness: no token typed, so Connect is disabled where the spec shows it filled) |
| ia-figma-sheets-connect | light | match | same |
| ia-figma-arrived | both | unreachable | needs a Figma file fixture (recorded JSON) via the Figma API stub |
| ia-figjam | both | unreachable | needs a FigJam fixture and an arrival surface (annotations summary) |
| ia-brand-steps (+ -1, -2, -3) | dark | differs | step 1: the chosen-logo chip shows a tick in an empty tile, not the logo preview (spec draws the logo), accepted types "SVG" vs "SVG, PNG or PDF" (capability, warning); step 2: the logo row is still "Reading…" (spec: "Read · 4 colours") with an indeterminate bar; step 3: copy "1 colours" (plural bug; spec "4 colours"), an extra amber "Couldn't read studio-brno.cz — fonts and colours" row that duplicates the callout, callout words "It couldn't be reached." vs spec "It didn't answer in 20 s.", amber warning glyph (spec neutral). The opening state (`ia-brand-steps`) shows an empty drop well where the spec shows the chosen logo |
| ia-brand-steps (+ -1, -2, -3) | light | differs | same |
| ia-brand | both | unreachable | needs a readable website or a recorded brand-read fixture |
| ia-missing | both | unreachable | needs a two-peer sync fixture or a seeded "waiting" asset state |
| ia-missing-gone | dark | differs | frame hatch + warning card + Relink… match (impl card line is red, spec neutral grey: warning); the inspector Missing box ("Added by Tereza on 1 Oct and removed from her Mac…", Relink… + Replace…) is not in the shot (Canvases tab shown, frame not selected) and Replace… is not built (state plane has no who/when) |
| ia-missing-gone | light | differs | same |
| ia-edges | both | unreachable | nine conditions (huge, twice, .psd, offline, Tereza's, link, Figma access, no Google key, HEIC) need harness stubs |
| ia-advanced | dark | differs | mono values break mid-word ("assets/Bann er-wide.jpg", `<img src=…`); a "kept open" chip beside the fold label; Original / Edits / Cut-out rows and the "Import the same way from Terminal" command card absent (data-conditional, cannot confirm); the fold is pinned to the panel foot over a gap |
| ia-advanced | light | differs | same |

## Summary

match (both themes): ia-assets-panel, ia-figma-sheets-connect. match one theme: ia-asset-details (dark). differs: ia-drop-photos, ia-placed, ia-assets-keys, ia-assets-browse, ia-assets-find, ia-assets-tidy, ia-photo-inspector, ia-photo-steps, ia-gen-ask, ia-figma-sheets, ia-brand-steps, ia-missing-gone, ia-advanced. unreachable: ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges.

```json
{"canvas":"12 Import and Assets","dir":"12-import-and-assets","match":["ia-assets-panel","ia-figma-sheets-connect"],"match_one_theme":{"ia-asset-details":"dark"},"differs":["ia-drop-photos","ia-placed","ia-assets-keys","ia-assets-browse","ia-assets-find","ia-assets-tidy","ia-photo-inspector","ia-photo-steps","ia-gen-ask","ia-figma-sheets","ia-brand-steps","ia-missing-gone","ia-advanced"],"unreachable":["ia-more-ways","ia-gen-placed","ia-figma-arrived","ia-figjam","ia-brand","ia-missing","ia-edges"]}
```
