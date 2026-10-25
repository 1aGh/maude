# 12 Import and Assets — stage A evidence (G4)

22 artboards · 15 paired (dark + light; `ia-brand-steps` has three extra step pairs, `ia-figma-sheets` one extra) · 7 not reachable. Full-size pairs: `full-size-path.txt`; spec-only frames: `spec-only/`.

How to read: left = spec (Stage window body 1440×860, or the close-up's own panel, cropped), right = impl. Impl project = the e2e fixture + 18 generated "plasma" JPEGs in `assets/` + a `Photos` canvas (one 480×360 photo artboard) — a **browser lane with a Tauri stub** (no native file picker, no Finder drop events, no ElevenLabs/Google/Figma/network). The spec's asset library is 247 assets with AI-drawn pictures, tags and "Made by AI" chips; none of that exists in the fixture (data, not a defect). Dark compared frame by frame, light on a sample.

| id | theme | state | how reached | impl reachable? | first-glance differences |
|---|---|---|---|---|---|
| ia-drop-photos | dark · light | Dragging 6 photos from Finder onto an artboard: "Drop to place 6 photos in …", stack with a "6" badge | SYNTHETIC `dragenter`/`dragover` with a `DataTransfer` of 6 files on the artboard (browser lane has no Tauri file-drop events) | partially: only a dashed outline round the whole canvas frame appears; no "Drop to place 6 photos in <artboard>" chip, no drag ghost stack | Spec: blue chip on the target artboard + ghost stack; impl: generic dashed frame around the canvas area, nothing names the target. The real Finder drop needs the native shell. |
| ia-placed | dark · light | Placed 6 photos — still going up | plain browser (no Tauri), artboard selected, Assets › From this Mac… › file chooser with 6 files | partially: the chooser/import runs; the 6 photos land under "Just added 6" in the panel and the artboard stays one photo ("Not placed. That picture does not fit there; try another.") because the fixture's artboard holds a single `<img>`, not empty frames; no upload-progress ring / "going up to the cloud" status (local project) | Spec: 6 photos placed in a grid of empty frames with per-picture "uploading" marks and a cloud status. Impl: Inspector open on the image, "Just added" group at the top of the panel (nice), but no placement into the frame. |
| ia-more-ways | dark · light | Paste, a video file, a logo | — | **no** — paste/native picker for video and logo drops are native; only the Assets "From this Mac…" picker exists in the lane | spec-only |
| ia-assets-panel | dark · light | Assets tab: Photos / Video / Sound / Logos / Generated groups | left panel › Assets | partially: Search assets + "Not used" chip + Photos (19) grid only | Spec groups: Photos 120 ›, Video, Sound (waveform row), Logos & icons, Generated (with sparkle badge) and a "247 assets · 1.4 GB" foot, an "All kinds ▾" filter and a Generate sparkle button. Impl has no All-kinds filter, one group (fixture has only photos), a sparkle + "+" button pair, a "From this Mac…" row at the bottom, no foot count. Tile size and gap larger in impl (3-up, 76 px) vs spec's 3-up 52 px in a 255 px panel. |
| ia-assets-keys | dark · light | Place without dragging — select a tile, ↵ | click a tile | partially: tile selection shows the name + "Not used" overlay on the tile; the right-click menu "Place in <artboard> ↵ / Show details / Rename… / Copy / Move to trash" is not in this frame (shown in the details step) | Spec shows the menu next to a selected artboard with a "Place in MVP zápasu ↵" row; impl frame shows the selected tile only. |
| ia-assets-browse | dark · light | Photos 120 › — wide view to browse and pick many | click the "Photos" group heading | yes | Impl wide view exists (Assets › Photos 19, search, "Newest first", Large/Small), date group "22 Oct", file names under thumbs. Missing: checkbox selection circles on thumbs, the "6 selected · 18.4 MB · Place in <artboard> ↵" foot bar, a Clear link, "Zápas vs. Panthers · 27 Sep" event grouping. Panel opens over the canvas and clips the artboard at the panel's right edge (no gap). |
| ia-assets-find | dark · light | Search what's in the pictures — asked once per project (4 states) | typed "Match" in Assets search | partially: the names-and-tags search result + the "Search what's in the pictures too? … Turn on…" card are real; the permission sheet ("Describe the pictures in …?"), "Seen in the picture" results and the AI-not-connected state are not reachable (AI stub says signed out / needs a connection) | Spec is a 4-column board; impl shows state 1 only. Copy of the offer card matches the spec ("Search what's in the pictures too? AI can describe every picture and clip once, so a word finds IMG_2231.jpg as well." / "Turn on…"). Card is a muted block with "Turn on…" outlined button. |
| ia-assets-tidy | dark · light | "dron" by name and by picture · Not used anywhere · where the words come from | harness `Not used` chip. (search cleared first; Photos 17 not used of 19) | partially: "Not used" chip works (lists photos); the "Not counted: 12 kept only by older versions, 3 AI takes from today" explainer line, the Generated group, the "31 assets · 212 MB / Move 31 to the trash…" foot and the AI-saw caption panel are missing | Spec has an info banner under the chips + a foot with a trash action; impl has neither. |
| ia-asset-details | dark · light | An asset's details — photo, made by AI, footage, sound | right-click tile › Show details | partially: photo variant only (Size 640 × 480 · 137 KB · JPG, Added just now, "Place ↵", "Photo", Advanced fold) | Spec's photo card: large rounded picture, big filename, Size/Added (person avatar)/AI saw tag chips, "Place in MVP zápasu ↵" blue button, "Used in 4 canvases" list with canvas thumbs + chevrons, Advanced "file name · original path". Impl: small thumb, plain-text rows, grey "Place ↵" chip, a lone "Photo" label, Advanced line "file name"; no "Used in" list (nothing places it), no Added-by avatar. Made-by-AI / clip / sound variants not reachable (no such assets). |
| ia-photo-inspector | dark · light | Select a photo — the photo inspector (Placement, Look, Remove background, Apply to every use) | click the photo on the artboard | **partially / a finding**: the right panel that opens is the generic **element** inspector for `img` ("Hero › img · Image · Uses project · Fit Fill/Fit/Crop/Tile · Position · Size · Corners · Border · Effects"), not the photo inspector | Spec: compact photo card "IMG_2247.jpg · Photo" with Placement (Fill/Fit/Crop), 8 Look tiles (Original, Brighter, Warmer, Cooler, Punchy, Mono, Club green, Night), Light/Colour sliders, "Remove background", Replace…/Reset, "Only this use changes" with "Apply to every use…", Advanced. None of it appears for the fixture's `<img data-cd-id="photo">`. May be a fixture/detection thing (the real project's photos carry sidecar metadata) — worth checking in stage B whether the Photo tab needs something the fixture lacks. |
| ia-photo-steps | dark · light | Crop · Remove background · Done · Apply to every use | clicked a "Photo" tab (none was found) | **no** (same cause as above) | the shot shows the generic inspector only. |
| ia-gen-ask | dark · light | Generate an image — the ask | Assets › ✦ (or ⌘K › Generate with AI…) | yes | Impl: inline "Generate an image" card at the top of the Assets panel with textarea, "4 variants" select, Advanced, "Select an artboard first — it sets the picture's shape." error line (no artboard was selected), Cancel / Generate. Spec: a popover on the selected artboard with the ask in the middle of the canvas. Different placement; impl states a validation error immediately. |
| ia-gen-placed | dark · light | Four takes — the best one in the frame, ← → for the others | — | **no** — needs the generation provider (BYOK) | spec-only |
| ia-figma-sheets | dark · light | Paste a link · Connect once · Pick frames and where they go (3 sheets) | ⌘K › Import from Figma… | partially: sheet 1 (paste a link) real; sheet 2 (Connect Figma token) real (see `ia-figma-sheets-connect`); sheet 3 (pick frames) needs Figma API | Spec sheets are large rounded cards (≈370 px) with 16 px titles; impl sheet ≈420 px with 14 px title and tighter spacing; focus ring is blue on the field, "Import" disabled outlined button. "Figma isn't connected yet. Connect once to read this file. [Connect…]" present with the same words. Spec's note "A board from FigJam works too — it comes in as annotations." present. |
| ia-figma-sheets-connect | dark · light | sheet 2 only | paste a link › Enter | yes | Steps list text identical ("In Figma, open Settings › Security…"); impl title and token field slightly smaller; "Kept in this Mac's keychain…" line present; Cancel/Connect buttons outlined (spec: filled blue Connect). |
| ia-figma-arrived | dark · light | Figma frames arrive as artboards | — | **no** — needs the Figma API | spec-only |
| ia-figjam | dark · light | A FigJam board becomes the whiteboard | — | **no** — needs the Figma API | spec-only |
| ia-brand-steps | dark · light | Drop a logo or type a website · Reading · Couldn't read the site (3 steps) | ⌘K › Import a brand (first step) and the three extra pairs `-1/-2/-3` | yes | Step 1 (logo + website): impl "Drop a logo here · SVG · Choose logo file…" + "Website (optional)" + Import — spec's step 1 has the same fields with a larger drop zone. Step 2 "Reading…" with a progress bar + "Usually under 10 seconds…": the lane shows "Couldn't read" straight away with no network (impl: ● Couldn't read studio-brno.cz — fonts and colours, Try again) — the Reading state flashes by (not captured). Step 3 matches the spec in words ("Couldn't read studio-brno.cz. It couldn't be reached." / "Without the site, fonts stay as they are — pick one on the next step."). Impl modal ≈480 px wide, 14 px title, compact buttons. |
| ia-brand | dark · light | Import a brand — use it as the project's style | — | **no** — needs a reachable website to read | spec-only |
| ia-missing | dark · light | Not here yet — "Waiting for Jonas's Mac" | — | **no** — needs a synced project with a peer that holds the file | spec-only |
| ia-missing-gone | dark · light | Missing — no device has it: hatched frame, card with Relink…, inspector card with the explanation | canvas whose `<img src="assets/Nowhere-1.jpg">` points at a file that exists nowhere | partially | Spec: the whole picture frame is red-hatched with a centred card (warning icon, file name, "Missing — no device has it", blue Relink… button) and the photo inspector shows "Missing · Added by Tereza on 1 Oct and removed from her Mac before it synced…" with Relink… / Replace…. Impl: only a thin red-hatched strip along the top with the file name "Nowhere-1.jpg" on a dark chip; the frame body is blank white; no Relink… button and no explanation (the selected-frame inspector was not opened in this shot, so the inspector copy was not checked). |
| ia-edges | dark · light | Edge cases: huge, twice, .psd, offline, Tereza's, link, Figma access, no Google key, HEIC | — | **no** — nine separate conditions (network, hub, provider keys, file types) | spec-only |
| ia-advanced | dark · light | Under Advanced: how assets are stored | asset details › Advanced fold | partially: the fold opens in the details view ("file name" row, stored name); the on-disk listing card (`.design/assets/…`) and the sidecar JSON card from the spec are not UI in the app | Spec shows details Advanced with "Stored as / Original / Edits / Cut-out / In canvases" rows + a Copy "maude design import-asset" snippet; impl shows only the "file name" line. |

## Notes for the critics
- Harness caveats are stated per row.
- Light theme was sampled, not compared frame by frame.

## After (C9 round 2, 2026-10-24)

All 19 reachable ids were re-shot, dark and light, on the release client at branch `p8-c2-assets` (the `*.jpg` pairs above are the new ones). Per-id verdicts and the open list: [`fix-assets.md`](fix-assets.md).

| id | after |
|---|---|
| ia-assets-panel, ia-assets-keys, ia-assets-browse, ia-assets-find, ia-assets-tidy, ia-asset-details, ia-missing-gone, ia-figma-sheets(-connect), ia-brand-steps(-1/-2/-3) | fixed (dark + light) |
| ia-placed | fixed in code (toast with Undo); fixture refuses the place |
| ia-drop-photos | code fixed; the capture lane cannot drag inside the canvas iframe |
| ia-gen-ask | partly (calm line, kit chips, starters); AI-island hosting open |
| ia-photo-inspector, ia-photo-steps | fixture photos have human names; real imports are content-addressed |
| ia-advanced | no change (C1 fold) |
| ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges | unreachable (stubs not built) |

## After (stage D, 53ceb26c5)

The C9 builder already re-shot the 19 reachable ids on its own branch (table above, "After (C9 round 2)"); the stage-D pass re-shot only the ones that table lists as "shot still differs" or fixture-blocked, with **fixture changes only** (no product code). New fixture `photos2`: the photo is stored under a content-addressed name (`assets/<sha8>.jpg`, what a real import produces, which is what mounts the Photo section) and a new `Spread` canvas holds one artboard of six empty `<img data-cd-id>` frames. Spec side: reused (board `12 Import and Assets.tsx` unchanged since stage A). Full-size pairs for the six re-shot ids: `full-size-path.txt` (stage D line); the other ids keep C9's JPEGs (their full-size PNGs live in the C9 worktree, not in the stage-D folder).

| id | dark · light | note |
|---|---|---|
| ia-photo-inspector | re-shot, **now reachable**: the right panel opens with an Image / Photo tab pair | previously the generic element inspector |
| ia-photo-steps | re-shot, **now reachable**: Photo section (Look tiles Original… Night, Light / Colour, Remove background, Replace… / Reset, "Only this use changes" + Apply to every use…, Advanced) | |
| ia-drop-photos | re-shot, **now reachable**: the dragover event is dispatched inside the canvas frame at the artboard's own coordinates, and the artboard draws its outline plus the chip "Drop to fill 6 empty frames in order" | still synthetic (no native file drop) |
| ia-placed | re-shot, **now reachable**: Spread artboard selected, Assets › From this Mac… with 6 files fills the six frames; toast "Placed 6 photos in MVP zápasu. They're in Assets too." + Undo; "Just added 6" group | no upload ring (local project) |
| ia-gen-ask | re-shot with an artboard selected (⌘K › Generate with AI…): inline ask in the Assets panel | AI-island hosting is still open (C9) |
| ia-advanced | re-shot (details › Advanced fold) | unchanged by C9 |
| all other reachable ids | reused: C9's round-2 shots (same tip lineage) | see the C9 table |
| ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges | unreachable | stubs not built (network, hub peer, providers, nine conditions) |

## FINAL (stage D2, d3881fe41)

Final re-shoot, IMPL side, dark + light, on the release client built from `feat/maude-v2` @ `d3881fe41` (all stage C rounds 1-4 merged; client bundle = `fae2884fa`). Every pair in this folder (`<id>-<theme>.jpg`) was overwritten with this shot, replacing every earlier round's. Spec side: **reused** — the board `.design/ui/v2/12 Import and Assets.tsx` has not changed since the stage-A shot (`git log` on it is empty after 2026-10-21), so the stage-A spec PNGs were reused. Full-size pairs: `full-size-path.txt` (the "final (D2)" line). No product code touched; no verdicts here (the critic judges).

Harness: the committed `_d-harness-g4` scripts repointed to this worktree, plus `_d2-harness-g4/` (new scripts below). Playwright Chromium 1440x860, `window.__TAURI__` stub unless noted, throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`.

| id | dark · light | note |
|---|---|---|
| ia-assets-panel, ia-assets-keys, ia-assets-browse, ia-assets-find, ia-assets-tidy, ia-asset-details, ia-missing-gone | re-shot | `s12` on the `photos` fixture (18 plasma JPEGs + a Photos canvas + Gone) |
| ia-advanced | re-shot | `s12e` (dark) and `s12f` (light; the `s12e` light step timed out), `photos2` fixture, details › Advanced |
| ia-photo-inspector, ia-photo-steps | re-shot | `s12h`: the photo is selected with a **⌘-click** (a plain click now selects the artboard); the Image / Photo tab pair and the Photo section (Look tiles, Remove background, Replace, Only this use changes) draw |
| ia-gen-ask | re-shot | `s12e`: artboard selected, ⌘K › Generate with AI… |
| ia-drop-photos | re-shot | `s12e`: SYNTHETIC dragenter + dragover inside the canvas frame at the artboard's centre (no native file drop in a browser) |
| ia-placed | re-shot | `s12h`: Spread artboard selected, Assets › From this Mac… with 6 files (plain browser, no Tauri stub), shot after 7 s so the frames are filled and the toast shows |
| ia-figma-sheets, ia-figma-sheets-connect | re-shot | ⌘K › Import from Figma… (`s12`); paste a link, Enter → Connect step (`s12b`) |
| ia-brand-steps | re-shot | ⌘K › Import a brand, just opened (`s12`) |
| ia-brand-steps-1, -2, -3 | re-shot | `s12g` in a plain browser (the Tauri stub made the logo pick a native dialog): logo chosen via the file chooser + website typed → Import → Reading… → the site does not answer. `AGENT_BROWSER_SOCKET_DIR=/tmp/abg4` is set because the logo read shells out to agent-browser and a throwaway-HOME session name was too long for the socket path (earlier shots of this id showed "Couldn't read the logo" for that reason — harness, not product) |
| ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges | unreachable | stubs not built (network, hub peer, providers, nine conditions) |

## After (round 7, p8-c7-g1112b)

All reachable ids re-shot dark + light on the release client of branch `p8-c7-g1112b`; scripts in `_c7-harness-g1112b/` (`chain7.sh`; `s12c7.mjs` is the new one). Product and harness changes: [`fix-c7-oboard.md`](fix-c7-oboard.md).

| id | state | what changed in the frame |
|---|---|---|
| ia-assets-keys | re-shot | an artboard is selected and the tile menu is open (right-click): Place in Hero ↵ · Show details · Rename… · Copy · Move to trash |
| ia-assets-browse | re-shot | one tile clicked, the sixth ⇧-clicked: six picked, "6 selected · size · Clear · Place 6 in Hero ↵" |
| ia-assets-tidy | re-shot | the foot is one line inside the panel (count + "Move N to the trash…") |
| ia-photo-inspector | re-shot | Photo tab: Placement Fill · Fit · Crop under the name; Light / Colour are a track and a value (no number boxes) |
| ia-photo-steps | re-shot | Placement › Crop, then a double-click: crop mode on the canvas (tag "photo · crop", ↵ done · esc cancel) and "The whole photo stays — only the frame moves." |
| ia-placed | re-shot | the six photos are one selection with the "6 photos" tag; the inspector is the Photo one, not the Frame's |
| ia-missing-gone | re-shot | the picture inside the missing frame is selected: the inspector's Missing box with Relink… and Replace… |
| ia-brand-steps-3 | re-shot | the failed site is said once (callout), no second amber row; "1 colour" is singular (the fixture logo reads 2) |



## FINAL (D5, e37e7d82a) — merged tip after round 7

Every reachable id re-shot on the merged tip `feat/maude-v2` @ `e37e7d82a` (release-built client, light + dark, IMPL side only), by `_d5-harness-g4/chain1112.sh` (scenarios `s12 s12b s12e s12f s12g s12h s12c7`, the round-7 `_c7-harness-g1112b` set) on the Mac mini with Google Chrome (no Playwright Chromium download there). Spec frames reused from stage A: `.design/ui/v2/12 Import and Assets.*` last changed 2026-10-21 (one line), before the spec shoot. No match judged here.

Fixture note: the photo fixtures (18 files in `assets/`, the Spread canvas) are drawn in Chromium because the runner has no ImageMagick — same names and sizes as before, a blob "plasma" look instead of `plasma:fractal`.

| artboard id | light | dark | note |
|---|---|---|---|
| ia-drop-photos | re-shot | re-shot | |
| ia-placed | re-shot | re-shot | Spread artboard (six empty frames), Assets › From this Mac… › six files (`s12e`/`s12h`; the first `s12` try printed "no filechooser" and was overwritten by the later successful shot) |
| ia-assets-panel | re-shot | re-shot | |
| ia-assets-keys | re-shot | re-shot | artboard selected, tile menu open (`s12c7`) |
| ia-assets-browse | re-shot | re-shot | click + shift-click six (`s12c7`) |
| ia-assets-find | re-shot | re-shot | |
| ia-assets-tidy | re-shot | re-shot | `s12c7` |
| ia-asset-details | re-shot | re-shot | |
| ia-photo-inspector | re-shot | re-shot | `s12c7` |
| ia-photo-steps | re-shot | re-shot | Placement › Crop, double-click = crop mode (`s12c7`) |
| ia-gen-ask | re-shot | re-shot | |
| ia-figma-sheets, ia-figma-sheets-connect | re-shot | re-shot | |
| ia-brand-steps, ia-brand-steps-1/-2/-3 | re-shot | re-shot | `s12`, `s12b`, `s12g` |
| ia-missing-gone | re-shot | re-shot | picture selected: the Missing box (`s12c7`) |
| ia-advanced | re-shot | re-shot | |
| ia-more-ways | unreachable | unreachable | paste / native picker for video and logo drops are native |
| ia-gen-placed | unreachable | unreachable | needs the generation provider (BYOK) |
| ia-figma-arrived, ia-figjam | unreachable | unreachable | need the Figma API |
| ia-brand | unreachable | unreachable | needs a reachable website to read |
| ia-missing | unreachable | unreachable | needs a synced project with a peer that holds the file |
| ia-edges | unreachable | unreachable | nine separate conditions (network, hub, provider keys, file types) |

## Round 8 (p8-c8-misc2) — re-shot, light + dark (harness `_c8m2-harness-g4`, `s12g`)

| artboard id | after (round 8) |
| --- | --- |
| ia-brand-steps (= frame -1), -1, -2, -3 | re-shot: the chosen logo draws itself on the checker tile in the drop well (`bi-drop-ic--logo`); the website read is held by a route stub, so the Reading column (two Reading… rows, progress bar, "Usually under 10 seconds…") is on screen (-2), then answers "didn't answer" for the Edge column (-3). The opener pair uses the logo-chosen frame, which is what the board's first column draws |

## FINAL (D6, 3d58f57df)

Every reachable id re-shot, light + dark, IMPL side only, on the merged tip `feat/maude-v2` @ `3d58f57df` (stage C round 8 merged, release-built client) on the Mac mini (slot 2, Google Chrome), harness `_d6-harness-g4` (= `_c8m2-harness-g4` + the round-8 canvas-10 scenarios `s10cm`/`s10d` from `_c8-harness-g4`). Spec frames reused from stage A (the boards `.design/ui/v2/12 Import and Assets.*` have not changed since). Committed JPEG pairs overwritten. No match judged here.

| artboard id | light | dark | note |
|---|---|---|---|
| ia-drop-photos, ia-placed | re-shot | re-shot | |
| ia-assets-panel, ia-assets-keys, ia-assets-browse, ia-assets-find, ia-assets-tidy, ia-asset-details | re-shot | re-shot | `s12`, `s12c7` |
| ia-photo-inspector, ia-photo-steps | re-shot | re-shot | `s12c7` |
| ia-gen-ask, ia-figma-sheets, ia-figma-sheets-connect | re-shot | re-shot | |
| ia-brand-steps, ia-brand-steps-1, -2, -3 | re-shot | re-shot | `s12g` (website read held by a route stub; opener pair uses the `-1` frame) |
| ia-missing-gone | re-shot | re-shot | `s12c7` |
| ia-advanced | re-shot | re-shot | |
| ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges | unreachable | unreachable | unchanged: native picker/paste, BYOK provider, Figma API, a reachable website, synced peer, nine external conditions |

Harness note: picture fixtures are drawn in Chromium (no ImageMagick on the runner).

## after (round 10, p8-c10-misc)

Re-shot light + dark on the Mac mini (Google Chrome), impl side only; spec reused.

| id | theme | after | note |
| --- | --- | --- | --- |
| `ia-brand-steps` | dark | re-shot | the chosen logo tile is light-fixed (data-theme="light", light token scope) in both themes; also -1 / -2 / -3 |
| `ia-brand-steps` | light | re-shot | the chosen logo tile is light-fixed (data-theme="light", light token scope) in both themes; also -1 / -2 / -3 |

## FINAL (D7, 0d2eab1d6)

Every reachable id re-shot, light + dark, IMPL side only, on the merged tip `feat/maude-v2` @ `0d2eab1d6` (stage C round 10 merged, release-built client; run from harness commit `c9708768e` = that tip + `_d7-harness-g3/`) on the Mac mini (Google Chrome, `SHOT_CHANNEL=chrome`), harness `_d7-harness-g3/g4` (= `_c10m-harness-g4`, chain `chain12.sh`: s12 s12b s12e s12f s12g s12h s12c7, later scenarios win). Spec frames reused from stage A (the boards `.design/ui/v2/12 Import and Assets.*` have not changed since 2026-10-21). Committed JPEG pairs overwritten. No match judged here.

| artboard id | light | dark | note |
|---|---|---|---|
| ia-drop-photos, ia-placed | re-shot | re-shot | `ia-placed`: the first `s12` try logs `no filechooser`; `s12b` re-shoots it (later scenario wins) |
| ia-assets-panel, ia-assets-keys, ia-assets-browse, ia-assets-find, ia-assets-tidy, ia-asset-details | re-shot | re-shot | `s12`, `s12c7` |
| ia-photo-inspector, ia-photo-steps | re-shot | re-shot | `s12c7` |
| ia-gen-ask, ia-figma-sheets, ia-figma-sheets-connect | re-shot | re-shot |  |
| ia-brand-steps, ia-brand-steps-1, -2, -3 | re-shot | re-shot | `s12g` (website read held by a route stub; opener pair uses the `-1` frame); round 10: logo tile light-fixed |
| ia-missing-gone | re-shot | re-shot | `s12c7` |
| ia-advanced | re-shot | re-shot |  |
| ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges | unreachable | unreachable | unchanged: native picker/paste, BYOK provider, Figma API, a reachable website, synced peer, nine external conditions |

Harness note: picture fixtures are drawn in Chromium (no ImageMagick on the runner). 19 ids x 2 themes = 38 pairs.
