# 09 Export — bar 2 (v2-michal-verified-bar), D4 merged tip 21c9714cf

Read from the D4 pairs, light + dark for every id called verified; light for the rest (dark shows the same content gap).

- ex-social · verified (L, D) · none (px chip 432 x 540 consistent in both themes, preview fills)
- ex-print · verified (L, D) · none
- ex-web · verified (L, D) · none
- ex-inspector · verified (L, D) · none (Preset row stands in as the "Size: Custom" select per decision 14; 1 vs 2 export rows is fixture)
- ex-formats · differs · "new" tag missing on JPG and Sound only; menu clipped at the window bottom after Canva, so Web page (HTML), Code..., Project ZIP are not shown (cannot confirm)
- ex-video · differs · filmstrip is an empty blue bar (no stills, names, title lane, music bed); no In the cloud / On this Mac render cards
- ex-offline · differs · same as ex-video; no "Offline — kept on this Mac" top-bar status
- ex-canvas · differs · shot is a selection export of one Frame with a blank preview tile, not the canvas-scope sheet with kind rows ("Export <canvas> — N artboards")
- ex-batch-pick · differs · selection is 3 same-kind artboards so the mixed Fixed size / Print kind rows are not drawn; File names is a plain field, not the Canvas — artboard select
- ex-batch · differs · Folders offers only "One folder" (no "One per canvas"); sub line shows internal folder name "ui"; shared-parts hint and "In the cloud" note on the video row missing
- ex-huge · differs · Include row (folder checks) absent; "Project ZIP instead" link is grey, not accent text
- ex-print-warn · differs · in-sheet preflight warnings (QR 2 mm from the cut, font not embeddable) and the "2 mm to the cut" tag and Safe 5 mm legend never show (headless measure not run in the lane)
- ex-advanced · differs · exact scale "1" (board 2.5x); no JPG quality, Paper, Codec, Bitrate, Frame rate, GIF colours, Long videos, Render service; File names token card and terminal commands card absent; Bleed / Crop marks drawn as switches with notes vs mm field
- ex-history · differs · only the empty "No exports yet" panel; populated rows, header folder button, top-bar Exports icon not drawn
- ex-share-vs · unreachable · needs a project with people in it (second person); Share opens the "Move to the cloud?" card
- ex-handoff · differs · no "Last used" tag; extra 4th row "Design tokens" not on the board; no "Use the design system" checkbox + sub line; review hint is plain text (no pill / check icon, copy "Last review: no blockers"); sheet title has no sub line
- ex-handoff-edges · differs · sheet shows only the title with an empty body (no "Connect your Claude account" card, Cancel, Connect)
- ex-progress · differs · rows lack thumbnail tile and the named job ("Hype trailer · 2 videos · 4K" shows "MP4 · Canvas"); no "about 1 min left"; no header folder button; no Ready row with page count
- ex-states · differs · panel rows only with generic names and truncated "Recap the m…"; cloud / this-Mac cards not drawn
- ex-handoff-ready · unreachable · needs a finished AI handoff run
- ex-edges · unreachable · needs a viewer-role session plus a live AI edit

## Polish list
- ex-social · preview tile and px chips (432 x 540 vs 1080 x 1350) are fixture
- ex-print · focus ring on Export at open is heavy (visible, AA, not blocking); page-strip thumbnail content is fixture
- ex-web · Studio site / Homepage names and 834 x 1001 vs 1440 x 3120 are fixture
- ex-inspector · Preset row shown as Size select (inspector per 14); 1 export row vs 2 is fixture
- ex-formats · File name pattern follows the board's own token card
- ex-batch · title uses the project name and "13 canvases", counts are fixture
- ex-huge · "13 canvases in 1 folder" vs 93 / 524 is fixture
- ex-video · Sound switch off and "No sound on this timeline" (fixture clip has no audio)

## Side states
- ex-inspector/copied-toast · "Copied “…” as a PNG — paste it anywhere" toast after Copy as PNG · reachable (not shown in the shot)
- ex-history/context-menu · Show in Finder / Export again / Export again with other settings / Copy file names / Remove from list · reachable once rows are seeded
- ex-handoff-edges/offline-queued · Exports row "Queued — starts when this Mac is online" · reachable with an offline harness
- ex-handoff-edges/blockers · last review found blockers + Show on canvas · unreachable (needs a finished review run)
- ex-states/done-toasts · three toasts (done, partly done with Retry Recap, without sound) with Show in Finder · reachable with a seeded job result
- ex-progress/cloud-vs-mac · cloud and this-Mac render cards · reachable with a seeded jobs list
