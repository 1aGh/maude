# 09 Export — bar 3 (v2-michal-verified-bar), D5 merged tip e37e7d82a

Judged fresh from the D5 pairs (both themes read for every id called verified); full-size impl frames opened for ex-formats, ex-video, ex-offline, ex-batch, ex-advanced, ex-progress, ex-states, ex-history. Round-7 lead decisions honoured (inspector per 14, Connect card without an API-key row, owning board wins, Preset row as Size select).

- ex-social · verified (L, D) · none
- ex-print · verified (L, D) · none
- ex-web · verified (L, D) · none
- ex-inspector · verified (L, D) · none (Preset row stands in as Size select per decision 14)
- ex-formats · verified (L, D) · none. The menu is `max-height: min(440px, 100vh-160px); overflow: auto`, so Web page (HTML), Code…, Project ZIP sit below the fold of the shot (rows exist in `export-copy.js`); the shot does not show them. Re-shoot with the list scrolled when convenient
- ex-video · differs · summary line follows `est.lane` (server answer), not the picked Render card: "In the cloud" is ticked, the footer says "about 45 seconds on this Mac" (board: "about 2 min in the cloud"). Both themes
- ex-offline · differs · same footer mismatch (cloud card ticked, footer "on this Mac"); the board draws On this Mac ticked offline with the footer "starts now on this Mac, about 3 min". Top bar "Offline — kept on this Mac" is now there
- ex-canvas · verified (L, D) · none (kind rows, thumbs, preset selects, Folders, Save to, footer all drawn)
- ex-batch-pick · verified (L, D) · none (File names select "Canvas — artboard" drawn; 3 vs 5 artboards is fixture)
- ex-batch · differs · Folders select offers only "One folder" (board: "One per canvas", with its path hint "social/matchday/DOMA…"); `export-sheet.jsx:528` has the one option
- ex-huge · verified (L, D) · none blocking (Include row, accent "Project ZIP instead", big-export line, 4 kind rows present)
- ex-print-warn · verified (L, D) · none (both real preflight warnings, "2 mm to the cut" tag, Safe legend)
- ex-advanced · differs · no JPG quality (85 %) row; Bleed is a switch, board has a "3 mm" field; Paper is plain text, board a select; the group headings (Image / Print PDF / Video / Where it renders) are missing; the Text select is clipped at the right edge of the sheet
- ex-history · verified (L, D) · none (rows named, tiles, header folder button, row menu open with all 5 items, foot lines)
- ex-progress · verified (L, D) · none; "about 1 min left" needs the cloud lane's progress sample, so it is e2e-later (listed under Side states)
- ex-states · verified (L, D) · none for the panel + top-bar ring; the three done / partly-done / without-sound toasts are a second storyboard frame (listed under Side states)
- ex-share-vs · unreachable · needs a project with people in it (second person)
- ex-handoff · verified (L, D) · none ("Last used", design-system check + sub, review pill, 3 rows)
- ex-handoff-edges · verified (L, D) · none for the connect card (no API-key row per lead decision); offline-queued and blockers frames are side states
- ex-handoff-ready · unreachable · needs a finished AI handoff run
- ex-edges · unreachable · needs a viewer-role session plus a live AI edit

## Polish list
- ex-social · preview tile and px chips (432 x 540) are fixture
- ex-print · Export focus ring at open is heavy (visible, AA); page-strip content is fixture
- ex-web · names and 834 x 1001 are fixture
- ex-inspector · 1 export row and "Export 1 file" vs 2 are fixture
- ex-formats · "new" tags on JPG and Sound only are not drawn (release marker, not a control)
- ex-video · file name "…16-9@4x" with 1080p picked (token uses scale, board writes the quality, "— 4K"); "Suggested for 4K" note shown at 1080p and 4K greyed (harness estimate, 480 x 270 source); playhead 0:00 vs 0:04, Captions greyed "No speech to caption" and no BPM on the music bed are fixture
- ex-offline · default tick is In the cloud (the harness estimate suggests cloud); board ticks On this Mac; unrelated timeline panel behind the sheet is fixture
- ex-canvas · sub line names the fixture project, not "2026/combine"
- ex-batch · shared-parts hint ("_broadcast, _social and _video hold shared parts…") needs artboard-less canvases in the fixture; counts and names are fixture
- ex-huge · the board has no Folders / Save to rows on Whole project; the product keeps them because a project export still needs a place to save (board follow-up, not a code change); Include shows "1 folder" (fixture)
- ex-print-warn · "Add the back" is ticked by default (the board draws it off here, ticked in ex-print); fixture flyer is not the board's artwork
- ex-advanced · Status reads "This Mac renders — no service needed" (local project; board "Ready"); one Terminal/Copy button instead of a copy icon per command row; Other format row sits in the fold
- ex-history · long names and "Exported 114 of 115 — …" are clipped by the panel width; hover icons show on every row
- ex-progress · Ready row meta "PDF · On this Mac · 19 min ago" vs "Print PDF · 5 pages" (fixture)

## Side states
- ex-inspector/copied-toast · "Copied “…” as a PNG — paste it anywhere" toast · reachable, not in the shot
- ex-states/done-toasts · done, partly done (Retry Recap) and without-sound toasts with Show in Finder · reachable with a seeded job result
- ex-progress/eta · "about 1 min left" on the running cloud row · unreachable here (needs the render service's progress sample; e2e-later)
- ex-handoff-edges/offline-queued · Exports row "Queued — starts when this Mac is online" · reachable with an offline harness
- ex-handoff-edges/blockers · last review found blockers + Show on canvas · unreachable (needs a finished review run)
- ex-history/context-menu · shown open in the shot, matches the board (no longer a gap)
- ex-formats/other-menu-below-fold · Web page (HTML), Code…, Project ZIP rows · reachable (scroll the list)
