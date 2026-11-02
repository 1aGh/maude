# 12 Import and Assets — stage D critic re-check (one critic, four lenses)

Sources: stage-D pairs `53ceb26c5` (photo-inspector, photo-steps, drop-photos, placed, gen-ask, advanced, full size) and C9 round-2 pairs (all others, full size from the C9 worktree). Dark read frame by frame; light read for assets-panel, asset-details, figma-sheets-connect, brand-steps. R1 (v2 accent) is fixed: impl Share/Place/Undo measure rgb(0,119,194) dark / (0,116,195) light = spec. R2 (chevrons), R3 (buttons), R5 (sheet material), R4 (island geometry) are fixed in the shots. The impl's extra top-right sliders island and the "Local project" / harness toolbar state are canvas 14 / harness, not counted.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ia-drop-photos | both | differs | copy: chip says "Drop to fill 6 empty frames in order" (spec "Drop to place 6 photos in Fotky ze zápasu"; cannot confirm the spec string from this fixture, the board's artboard has 4 frames for 6 photos); drag ghost "IMG_2231.jpg + 5 more" is native; Assets panel not shown (Canvases tab) |
| ia-placed | both | differs | the six photos are not selected as a group with the "6 photos" tag (board note: "placed … and selected"); the Frame inspector of the artboard is open instead; upload bars + Syncing… (local project, data) |
| ia-more-ways | both | unreachable | prepare-in-place clip card, "3 clips · Assemble", logo notice, paste "Screenshot · now" entry: product work not started |
| ia-assets-panel | both | match | (fixture: one group, no sound/logos/generated; "From this Mac…" row kept by decision v2-8.5-c9-from-this-mac-row-04-owns) |
| ia-assets-keys | both | differs | the tile menu is not in the frame (cannot confirm "Place in <artboard> ↵ / Show details / Rename… / Copy / Move to trash"); Rename… not built (fix-assets open); no artboard selected |
| ia-assets-browse | both | differs | the wide view covers the tab row (spec keeps Canvases/Layers/Assets + panel-left icon in the header row); selection state "6 selected · 18.4 MB · Clear · Place 6 in … ↵" foot bar not shot (cannot confirm) |
| ia-assets-find | both | differs | only state 1 of 4 reachable (consent sheet, "Seen in the picture", AI-not-connected need an AI stub); cannot confirm 2–4 |
| ia-assets-tidy | both | differs | the foot button "Move 17 to the trash…" runs past the panel's right edge and is clipped; the Photos group lists all 17 tiles (spec caps at two rows); "Not counted…" banner absent (data-conditional, possibly `usedIn` dropped from the list, unconfirmed) |
| ia-asset-details | both | match | (data: avatar, AI-saw chips, Place in <artboard>, made-by-AI/clip/sound variants; Used-in rows with thumbs + chevrons verified in dark; light unused photo has none, data) |
| ia-photo-inspector | both | differs | an Image / Photo tab pair the board does not draw; no Placement Fill/Fit/Crop seg; Light/Colour carry an extra numeric field; "Remove background" is a plain button (spec: accent-outlined); header "52d8ab13.jpg" is the stored name (data); inspector title row gone (ok) |
| ia-photo-steps | both | differs | crop step not reachable: "4:5 · from the artboard" pill, crop handles, Fill/Fit/Crop seg with Crop active, "The whole photo stays — only the frame moves."; Remove background, Done, Apply-to-every-use sheet not shot |
| ia-gen-ask | both | differs | the ask is the inline card in the Assets panel, not the AI chat island ("Gameweek 5 photo" header, mode chips, option chips, scope chip, round send button); native-looking "4 variants" select; provider line "No image provider is ready…" replaces the cost + SynthID lines |
| ia-gen-placed | both | unreachable | needs a generation provider stub or a recorded-takes fixture |
| ia-figma-sheets | both | differs | sheets 1 and 2 match (lock callout, 372 wide, words; accent focus ring on the link field is a warning); sheet 3 (pick frames, where they go) not shot — needs a Figma API stub |
| ia-figma-arrived | both | unreachable | needs a Figma file fixture (recorded JSON) |
| ia-figjam | both | unreachable | needs a FigJam fixture + an arrival surface |
| ia-brand-steps | both | differs | step 1 matches (logo-chosen chip state not shot, "SVG" vs "SVG, PNG or PDF" is a capability warning); step 2: "Reading…" progress state with the Read row not shot; step 3: no "Read studio-brno-logo.svg" row, no "Continue with the logo" primary, callout text differs (needs a logo + a timeout case), warning glyph is amber (spec neutral) |
| ia-brand | both | unreachable | needs a readable site or a recorded brand-read fixture |
| ia-missing | both | unreachable | needs a two-peer sync fixture or a seeded "waiting" asset state |
| ia-missing-gone | both | differs | the frame hatch + card + Relink… now match; the inspector Missing box ("Added by Tereza on 1 Oct and removed from her Mac…", Relink… + Replace…) is not shown and Replace… is not built (state plane has no who/when) |
| ia-edges | both | unreachable | nine conditions (huge, twice, .psd, offline, Tereza's, link, Figma access, no Google key, HEIC) need harness stubs |
| ia-advanced | both | differs | mono values break mid-word ("assets/Pitc / h.jpg", "<img / src=…"); a "kept open" chip next to the fold label; the fold pinned to the panel foot with a gap (spec follows content); Original / Edits / Cut-out rows and the Terminal command card absent (data-conditional, not confirmable) |

Light was spot-checked, not read for every differing id; every `differs` row holds in both themes unless the cause is a fixture state.
