# 09 Export — bar 4 (v2-michal-verified-bar), D6 merged tip 3d58f57df

Judged fresh from the D6 pairs, both themes read for every id called verified; full-size impl frames opened for ex-offline, ex-advanced, ex-batch (the round-8 ids). Round-7/8 lead decisions honoured (inspector per 14, Connect card without an API-key row, owning board wins, Bleed / Paper read-only, Folders One per canvas). Round-8 MUST rows of bar 3 (ex-video, ex-offline, ex-batch, ex-advanced) are all closed in the shots.

- ex-social · verified (L, D) · none
- ex-print · verified (L, D) · none
- ex-web · verified (L, D) · none
- ex-inspector · verified (L, D) · none (Preset row stands in as Size select per decision 14)
- ex-formats · verified (L, D) · none (rows below the fold are a side state)
- ex-video · verified (L, D) · none. Footer now follows the ticked Render card ("1 file · about 6 MB · about 45 seconds in the cloud" with In the cloud ticked); both Render cards, filmstrip, Captions, Sound all present
- ex-offline · verified (L, D) · none. Top bar says "Offline — kept on this Mac"; cloud card reads "Waits for a connection, then starts by itself" with the offline glyph, On this Mac card drawn; footer follows the ticked card. Default tick differs from the board (see Polish)
- ex-canvas · verified (L, D) · none
- ex-batch-pick · verified (L, D) · none
- ex-batch · verified (L, D) · none. Folders select now offers One per canvas, path hint "<canvas> · <first file>" shown
- ex-huge · verified (L, D) · none (Include row with two ticks, accent Project ZIP instead, big-export line, 4 kind rows)
- ex-print-warn · verified (L, D) · none (both real preflight warnings, "2 mm to the cut" tag, Safe legend)
- ex-advanced · verified (L, D) · none. Part headings (Image / Print PDF / Video / Where it renders) present, JPG quality 85 %, Bleed switch + 3 mm field (read-only by decision), Paper select, Text select no longer clipped; command part carries both lines (terminal + Claude Code) below the shot's crop
- ex-history · verified (L, D) · none (named rows, tiles, folder button, row menu open with 5 items, foot lines)
- ex-progress · verified (L, D) · none ("about 1 min left" is a side state, needs the cloud progress sample)
- ex-states · verified (L, D) · none for the panel rows + top-bar ring; the done / partly-done / without-sound toasts are a second storyboard frame (side row)
- ex-share-vs · unreachable · needs a project with people in it (second person); the shot shows the Move to cloud sheet of a local project, not the board's two sheets
- ex-handoff · verified (L, D) · none
- ex-handoff-edges · verified (L, D) · none for the Connect card (no API-key row per lead decision); offline-queued and blockers frames are side states
- ex-handoff-ready · unreachable · needs a finished AI handoff run
- ex-edges · unreachable · needs a viewer-role session plus a live AI edit

## Polish list
- ex-social · preview tile and px chips (432 x 540) are fixture
- ex-print · Export focus ring at open is heavy (visible, AA); page-strip content is fixture
- ex-web · names and 834 x 1001 are fixture
- ex-inspector · 1 export row and "Export 1 file" vs 2 are fixture
- ex-formats · "new" tags on JPG and Sound only are not drawn (release marker, not a control)
- ex-video · file name "...16-9@4x" with 1080p picked and "Suggested for 4K" note (harness estimate, 480 x 270 source); playhead 0:00 vs 0:04, Captions greyed "No speech to caption", no BPM on the music bed, 1 file vs 2 videos are fixture; footer ETA (45 s vs 2 min) is the estimate
- ex-offline · default tick is In the cloud (the harness estimate suggests cloud; board ticks On this Mac, footer "starts now on this Mac, about 3 min" with a video count); footer says "about 45 seconds in the cloud" while offline although the card says it waits; unrelated timeline panel behind the sheet is fixture
- ex-canvas · sub line names the fixture project, not "2026/combine"
- ex-batch · shared-parts hint ("_broadcast, _social and _video hold shared parts...") needs artboard-less canvases in the fixture; counts and names are fixture; the big-export line appears at 21 files (state-driven, board draws it only in ex-huge)
- ex-huge · the board has no Folders / Save to rows on Whole project; the product keeps them because the ZIP still needs a destination (board follow-up); Include shows "1 folder" (fixture)
- ex-print-warn · "Add the back" is ticked by default (board draws it off here, ticked in ex-print); fixture flyer is not the board's artwork
- ex-advanced · Status reads "This Mac renders — no service needed" (local project; board "Ready"); one Terminal/Copy button per command line instead of a copy icon; Codec is static text and Bitrate reads Automatic (board: selects with H.264 / High); GIF colours disabled with no GIF format; Image title says "PNG · JPG" without "· SVG" (honest); Bleed amount and Paper not editable (decision v2-p8-c8-exshare-bleed-readonly-paper-single); Other format row sits in the fold
- ex-history · long names and "Exported 114 of 115 — ..." clipped by the panel width; hover icons show on every row
- ex-progress · Ready row meta "PDF · On this Mac · 19 min ago" vs "Print PDF · 5 pages" (fixture)
- ex-handoff · Lottie row is enabled (the board greys it for a canvas with no animated frame; fixture canvas)

## Side states
- ex-inspector/copied-toast · "Copied "..." as a PNG — paste it anywhere" toast · reachable, not in the shot
- ex-states/done-toasts · done, partly done (Retry Recap) and without-sound toasts with Show in Finder · reachable with a seeded job result
- ex-progress/eta · "about 1 min left" on the running cloud row · unreachable here (needs the render service's progress sample; e2e-later)
- ex-handoff-edges/offline-queued · Exports row "Queued — starts when this Mac is online" · reachable with an offline harness
- ex-handoff-edges/blockers · last review found blockers + Show on canvas · unreachable (needs a finished review run)
- ex-formats/other-menu-below-fold · Web page (HTML), Code..., Project ZIP rows · reachable (scroll the list)
- ex-batch/shared-parts-hint · hint row for artboard-less canvases · reachable with a fixture that has them
