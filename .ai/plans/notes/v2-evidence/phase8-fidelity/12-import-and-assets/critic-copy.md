# copy-critic — 12 Import and Assets (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/12 Import and Assets.tsx` · voice: CONTRACT §3 words + §4 voice + §7 (Assets, search in pictures, Figma, not-here-yet vs missing, photo edits per use) · impl frames: `.claude/worktrees/agent-a0a73ec7448623bcc/.scr/impl/12-import-and-assets/` (dark read frame by frame; light not re-read — every string below is code-sourced and theme-independent, so each row holds for dark and light)_

Fixture content (18 "plasma" JPEGs, `pic.png`, `Matchday-01.jpg`, the one-photo `Hero` artboard, `Photos`/`Gone` canvas names, artboard labels like `EXPORT/01 · ARTIFACT`) is not a finding.

## ia-drop-photos · dark + light (synthetic drag)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Drop pill missing | `Drop to place 6 photos in Fotky ze zápasu` | nothing names the target; no such string in client | drop-target overlay (none) | blocker |
| Drag ghost name | `IMG_2231.jpg + 5 more` | no ghost (native drag) | — | warning (needs native drop) |
| Asset search shows ⌘K | `Search assets` (no key) | `Search assets` + `⌘K` — ⌘K is Search (CONTRACT §2/§7), not asset search | `client/v2/left-panel/assets-panel.jsx:592` | blocker (every Assets frame) |
| Kind filter | `All kinds ▾` | absent; no string in client | `assets-panel.jsx` bar | blocker (every Assets frame) |
| Add action | `+` titled `Add files…` | `+` titled `Add files…` **and** a list row `From this Mac…` (two names for one action) | `assets-panel.jsx:612-613, 814` | warning |
| Panel foot | `247 assets · 1.4 GB` | none (only search / Not-used feet exist) | `assets-panel.jsx:828` | blocker (every Assets frame) |

## ia-placed · dark + light (file chooser)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Done toast | `Placed 6 photos in Fotky ze zápasu. They're in Assets too.` + `Undo` | none (placement refused); **no string in client** | `client/v2/assets/place-asset.js` | blocker |
| Refusal line | — | `Not placed. That picture does not fit there; try another.` | `client/v2/assets/place-asset.js:22` | not-a-finding (fixture's single `<img>`); note "try another" names no verb/target |
| Group head | `Just added 6` | match | — | — ok |
| Hover tip truncated | `IMG_2231.jpg` / `Used in 4 canvases` | `Matchday-…` / `Used in 1 c…` | tile tip CSS (`ia-tile-tip` equivalent) | warning |
| Selection tag | `6 photos` | n/a (not placed) | — | warning (unreached) |

## ia-assets-panel · dark + light

Same panel-wide rows as ia-drop-photos (⌘K hint, no `All kinds`, no foot). Groups `Video` / `Sound` / `Logos & icons` / `Generated` absent = fixture (photos only). Drop pill `Drop to replace the photo` — **no string in client** → blocker.

## ia-assets-keys · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Tile menu rows missing | `Place in MVP zápasu ↵` · `Show details ⌘I` · `Rename…` · `Copy ⌘C` · `Move to trash` | `Place in … ↵` · `Show details ⌘I` · `Move to trash` (no Rename…, no Copy) | `client/v2/assets/tile-menu.jsx:17-30` | blocker |
| Selected tile tip | name + where used | `pic.png` / `Used in 2 c…` (truncated) | tile tip | warning |

## ia-assets-browse · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Header | `‹ Assets` · `Photos 120` · `Search photos` · `Newest first ▾` · `Large / Small` | same words (`browse-model.js:22-34`) | — | — ok |
| Day heads | `Zápas vs. Panthers · 27 Sep` | `22 Oct` (date only) | `client/v2/assets/browse-model.js:57-79` | warning |
| Pick bar | `6 selected · 18.4 MB` · `Clear` · `or drag them onto an artboard` · `Place 6 in Fotky ze zápasu ↵` | bar exists (`browse-view.jsx:150-190`) but the `or drag them onto an artboard` hint has no string; nothing picked in the frame | `client/v2/assets/browse-view.jsx` | warning |

## ia-assets-find · dark + light (state 1 only)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Result group head | `In the name or tags 2` | `Photos 3` (kind group, even while searching); `In the name or tags` has no string | `client/v2/left-panel/assets-panel.jsx` search grouping | blocker |
| Offer card | `Search what's in the pictures too? AI can describe every picture and clip once, so a word finds IMG_2231.jpg as well.` · `Turn on…` | match | `client/v2/assets/describe-consent.jsx:36` | — ok |
| Foot | `Searched 247 assets — names and tags` | `Searched 19 assets — names and tags` | — | — ok |
| Sheet / "Seen in the picture" / not-connected | `Describe the pictures in Alligators brand?` · `Describe pictures` · `Connect your Claude account to search what's in pictures, too.` | strings exist (`describe-consent.jsx:21,80,110`; `assets-panel.jsx:732`), not reached | — | warning (unreached) |

## ia-assets-tidy · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Foot + action | `31 assets · 212 MB` · `Move 31 to the trash…` | `17 assets · 2.1 MB` · `Move 17 to the trash…` | `client/v2/assets/tidy.jsx:35-40` | — ok |
| Not-counted line | `Not counted: 12 kept only by older versions, 3 AI takes from today.` | absent — nothing to exclude in the fixture (`tidy.jsx:49` returns '') | — | not-a-finding |
| "dron" by picture / AI-saw panel | `Seen in the picture`, `AI saw`, `Described on 6 Oct with your Claude account…` | not reached (no descriptions) | — | warning (unreached) |

## ia-asset-details · dark + light (photo only)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Back label | `‹ Assets` | `Assets` | details header | warning |
| Added row has no person | `Jonas · 27 Sep, 21:40` | `just now` | `client/v2/assets/details.jsx` | warning (local fixture has no author) |
| Place / Used in / Advanced hint | `Place in MVP zápasu ↵` · `Used in 4 canvases` · `file name · original path` | `Place ↵` (no artboard selected — `details-model.js:195`) · `Used in 2 canvases` · `file name` (no original — `details-model.js:186-191`) | — | — ok (data-driven) |
| Made by AI / clip / sound variants | `Made with Google · Nano Banana Pro`, `May carry an invisible SynthID watermark…`, `Good moments`, `Commercial use depends on your ElevenLabs plan.`, `Generate more like this` | not reachable (no such assets); `SynthID` has **no string in client** | — | blocker (licence line missing) |

## ia-photo-inspector · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Inspector names the HTML tag | `IMG_2247.jpg` · `Photo` | breadcrumb `Hero › img`, title `img` · `Image` | element inspector header (`client/v2/inspector/frame.jsx`) | blocker |
| Photo section absent | `Look` (Original · Brighter · Warmer · Cooler · Punchy · Mono · Club green · Night) · `Light` · `Colour` · `Remove background` · `Replace…` / `Reset` · `Only this use changes` · `IMG_2247.jpg is in 3 more canvases — they keep the original…` · `Apply to every use…` | none shown; strings exist in `client/v2/photo/photo-section.jsx:48-54` but the section doesn't mount for this `<img>` | photo-section mount condition | blocker (missing state) |
| Placement row | `Placement` · `Fill · Fit · Crop` | `Fit` · `Fill · Fit · Crop · Tile` | `client/v2/inspector/kinds/image.jsx:24-26,161` | warning |
| DS link | `Uses <system>` | `Uses project` (fixture system named "project") | `client/v2/ds/uses-link.jsx:13-25` | not-a-finding (fixture) |

## ia-photo-steps · dark + light

Same cause as ia-photo-inspector — the photo section never mounts, so `4:5 · from the artboard`, `The whole photo stays — only the frame moves.`, `AI is removing the background`, `Background removed by AI`, `Off shows the original photo. This use only.` and the sheet `Apply Punchy and the cut-out to every use?` · `Apply to every use` are not on screen. → blocker (one, same root).

## ia-gen-ask · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Cost / time line | `About 30 s · billed to your Google key` | absent; no string in client | generate card in `assets-panel.jsx` | blocker |
| Licence line | `Images may carry an invisible SynthID watermark. Check Google's terms for commercial use.` | absent; no string | same | blocker |
| Shape chip | `4:5 · from Gameweek 5 ▾` | absent (no artboard) — and the shape is said as an error instead | same | warning |
| Error shown before any attempt | — | `Select an artboard first — it sets the picture's shape.` in red on open | generate card | warning (CONTRACT §4: status after the fact; here it's a precondition hint, say it calmly) |
| Hint, variants, buttons | `Describe what should be in the picture. AI makes four takes…` · `4 variants` | match; `Cancel` / `Generate` | — | — ok |
| Suggestions | `Use our photos as a style` · `Daylight instead` | absent | — | warning |

## ia-figma-sheets · dark + light (sheet 1)

`Import from Figma` · `Figma link` · `Figma isn't connected yet. Connect once to read this file.` · `Connect…` · `A board from FigJam works too — it comes in as annotations.` · `Cancel` / `Import` — **exact match** (`client/v2/import/figma-model.js:37`). Placeholder `figma.com/design/…` is the empty field's (board shows a typed link). Sheet 3 (`Import 6 frames`, `Put them in`, `Uniformy-2027 (Figma)`, `Make editable … Figma Dev Mode on a paid seat`) needs the Figma API — unreached.

## ia-figma-sheets-connect · dark + light

`Connect Figma` · steps 1–3 (`Settings › Security`, `File content: read`, `Paste it here.`) · `Access token` · `Kept in this Mac's keychain. Used only to read files you import; Settings › Connections removes it.` · `Cancel` / `Connect` — **exact match** (`figma-model.js:41-49`).

## ia-brand-steps · dark + light (steps 1 / 3; step 2 flashed by)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Empty drop zone formats | `Logo · or drop another — SVG, PNG or PDF` | `Drop a logo here` · `SVG` (+ `Choose logo file…`) | `client/v2/import/brand-sheet.jsx:232` | warning (formats list narrower than the board's) |
| Field, fine print, buttons | `Website (optional)` · `Colours come from the logo; fonts and more colours from the website. Nothing changes until you choose.` · `Cancel` / `Import` | match (`brand-sheet.jsx:255`) | — | — ok |
| Couldn't-read reason | `Couldn't read studio-brno.cz. It didn't answer in 20 s. The logo's colours are kept.` · `Continue with the logo` | `Couldn't read studio-brno.cz. It couldn't be reached.` (no logo given, no network) | `brand-sheet.jsx` | not-a-finding (different, real condition) |
| Reading row | `Reading…` · `Usually under 10 seconds. The site is read once; nothing is sent to it.` | string exists (`brand-sheet.jsx:326`), not captured | — | warning (unreached) |
| Status word spacing | `Read` / `Reading…` beside the source | `● Couldn't read` with a wide gap before `studio-brno.cz — fonts and colours` | row layout | warning |

## ia-missing-gone · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| On-frame card | `partneri-2025.png` · `Missing — no device has it` · `Relink…` | file-name chip only; `Missing — no device has it` has **no string in client** | missing-frame overlay (`client/v2/assets/missing-frame.jsx`) | blocker |
| Inspector box (code, not shot) | `Missing` · `Added by Tereza on 1 Oct and removed from her Mac before it synced. No device has it now; the rest of the design is safe.` · `Relink…` / `Replace…` | `Missing` · `No device has this file now. The rest of the design is safe.` · `Relink…` (no who/when, no Replace…) | `client/v2/assets/missing-frame.jsx:56-76` | warning |

## ia-advanced · dark + light

`Advanced · file name` · `Stored as assets/pic.png Copy` · `In canvases <img src="assets/pic.png">` — rows match the board's (`details-model.js:178-191`); `Original` / `Edits` / `Cut-out` appear only with data; `Import the same way from Terminal` exists (`details-advanced.jsx:67`). The on-disk listing and the sidecar JSON cards are board explanation, not UI. **No copy difference.**

## Unreachable artboards (product work they need)

- **ia-more-ways**: paste / native video + logo drops — native shell drop events.
- **ia-gen-placed**: a BYOK generation provider; takes words (`← →`, best of four) unchecked.
- **ia-figma-arrived / ia-figjam**: the Figma API (token + file read).
- **ia-brand**: a reachable website to read.
- **ia-missing**: a synced project with a peer holding the file — `Waiting for Jonas's Mac` exists (`client/v2/ds/pins.js:25`).
- **ia-edges**: nine conditions (network, hub, provider keys, .psd/HEIC, Figma access).

## Root causes that hit several artboards

1. **Assets panel chrome differs from the board everywhere**: ⌘K hint on asset search (`assets-panel.jsx:592`), no `All kinds`, no `247 assets · 1.4 GB` foot, two names for Add (`From this Mac…` vs `Add files…`).
2. **Drop / place feedback has no words**: `Drop to place 6 photos in …`, `Drop to replace the photo`, `Placed 6 photos in … They're in Assets too.` exist nowhere in client.
3. **The photo section never mounts for a plain `<img>`**, so the element inspector speaks HTML (`img`, `Image`, `Fit`): ia-photo-inspector, ia-photo-steps, ia-placed.
4. **Generation's money/licence lines missing** (`About 30 s · billed to …`, SynthID): ia-gen-ask, ia-asset-details (Made by AI).
5. **Search groups by kind, not by where it matched** (`In the name or tags` / `Seen in the picture`): ia-assets-find, ia-assets-tidy.
6. **Missing has no on-frame words** (`Missing — no device has it`, Relink…): ia-missing-gone.
7. **Tile menu lacks Rename… and Copy** (`tile-menu.jsx:17-30`).

```json
{"canvas":"12 Import and Assets","critic":"copy-critic","blockers":16,"warnings":24,"verified_ids":["ia-figma-sheets-dark","ia-figma-sheets-light","ia-figma-sheets-connect-dark","ia-figma-sheets-connect-light","ia-advanced-dark","ia-advanced-light"]}
```
