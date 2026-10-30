# copy-critic — 09 Export · phase 8 stage B

_2026-10-22 · board `.design/ui/v2/09 Export.tsx` · impl frames `.claude/worktrees/agent-af625ef88bd36c798/.scr/impl/09/` · voice: CONTRACT §3–§4, §6 Export [C19/C21/B5], §7 Export done/scope/print colour · strings reviewed ≈ 380_

**Themes.** Copy does not change with the theme. Every light frame was read, and ex-handoff-dark was spot-checked (same strings), so each row covers **L·D**.
**Fixture.** Local project (so no cloud render, no people, no Share link), a single-format video, no handoff targets in settings, no DS for handoff, and counts (6 / 19 artboards, 13 canvases) all come from the fixture. They are not findings.

## TL;DR

**Blockers: 16** (12 in-lens + 4 unreachable) · Warnings: 34 · Verdict: **fix-and-retry**

The copy library (`export-copy.js`, `video-copy.js`, `print-copy.js`, `advanced-copy.js`, `handoff/targets.js`) is close to the board. What reaches the screen is thinner:
- **A one-artboard sheet never names the artboard.** Every single-artboard sheet reads `Export 1 artboard`, because `selectionLabel` is never passed.
- The print sheet sits on `Drawing the page…` and drops the back page.
- The video sheet says `1080p` next to `480 × 270`, claims music that isn't there, and offers only two caption choices.
- Folder scope names the internal `ui` directory.
- File name / Save to are missing from the body.

## Per artboard (L·D)

| id | difference | spec (board) | impl | owner | sev |
|---|---|---|---|---|---|
| ex-social | title doesn't name the selection | `Export “DOMA · Post 4:5 — feed matchday”` | `Export 1 artboard` | `client/v2/export/export-sheet.jsx:95` (`selectionLabel = null`; no caller passes it) → `export-copy.js:44-46` | blocker |
| ex-social | preview + its size line missing | picture + `1080 × 1350 · Post 4:5` | no preview column | `export/sections/image.jsx` | blocker |
| ex-social | File name / Save to not in the body | `File name [DOMA · Post 4-5 — feed matchday.png]` · `Save to Downloads` | absent (fold hint `File names, colour, scale`) | `export-sheet.jsx`, `advanced/names.jsx` | blocker |
| ex-social | Size choices lose their pixels | `1× 1080 × 1350 · 2× 2160 × 2700` | `1× · 2×` | `sections/image.jsx` | warning |
| ex-social | summary adds a place for images | `1 file · about 1.4 MB · a second` | `1 file · about 210 KB · a few seconds on this Mac` | `export-copy.js:93-100` `estimateWords` | warning |
| ex-social | sub line has no kind | (print: `LetakA6 · print`) | `Matchday` | `export-copy.js:64-70` `sheetSub` | warning |
| ex-social | ✓ Scope bar `Selection 1 · This canvas 6 · Folder 19 · Whole project 19 artboards`, `PNG · JPG · Other…`, `Instagram resizes anything larger.`, `Include annotations` + sub, `Cancel` · `Export ↵` | | | | — |
| ex-print | title | `Export “A · přední (FLAG)” + its back` | `Export 1 artboard` | as ex-social | (counted) |
| ex-print | preview never draws | page + `Page 1 of 2 · A6 · 105 × 148 mm` + legend `Bleed 3 mm · Cut · Safe 5 mm` | blank page + `Drawing the page…` | `sections/print-copy.js:34`, `preflight/paper.jsx` | blocker |
| ex-print | the back page isn't offered (B · zadní (FLAG) is on this canvas) | `Add “B · zadní (FLAG)”` / `page 2 — the back of this leták` · summary `1 PDF · 2 pages` | no row · `1 file · about 61 KB` | `print-copy.js:23` `backLabel`, `preflight/use-preflight.js` | blocker |
| ex-print | Bleed sub loses its number | `colour runs 3 mm past the cut` | `colour runs past the cut` (mm = 0) | `print-copy.js:20-21` (caller) | warning |
| ex-print | annotations look pickable on print | checkbox off + disabled + note | enabled checkbox + `Print files never carry them — pick PDF for a review copy.` | `export-copy.js:131-133`, `sections/print.jsx` | warning |
| ex-print | ✓ `Print PDF · PDF · PNG · Other…`, `Crop marks` / `where to cut — outside the bleed`, `RGB — the print shop converts to CMYK.` | | | | — |
| ex-web | Area loses its choice | seg `Full page 1440 × 3120 · Visible area 1440 × 900` | text `Full page` + `Image takes the full page, not just the visible area.` | `sections/web.jsx`, `export-copy.js:126` | blocker |
| ex-web | ✓ `Image · PDF`, `PNG 1× · PNG 2× · JPG 2×`, `2× stays sharp on Retina screens.`, `Code for a developer? Handoff to production… ⇧⌘H`. The title still reads `Export 1 artboard` (counted) | | | | — |
| ex-video | Quality names lie about the size | `1080p 1080 × 1920 · 4K 2160 × 3840` | `1080p 480 × 270 · 4K 960 × 540` | `sections/video-copy.js:19-24` (1080p = artboard's own size) + `sections/video.jsx` | blocker |
| ex-video | Sound line is unconditional | switch + `Music, mixed as on the timeline` (a video with music) | `Music, mixed as on the timeline` on a video with no music track | `sections/video.jsx:213-218` | blocker |
| ex-video | captions cut to two | `Burned in · As a file · Both · Off` + `No speech to caption` | `Off · Burned in` + `No speech to caption` | `sections/video.jsx:222-236` | blocker |
| ex-video | filmstrip says nothing; tick repeats | title lane, clip names, `Hype instrumental · 120 BPM`, ticks `0:00 0:05 0:10 0:15`, preview `Frame at 0:04 / scrub the strip below` | empty bars; ticks `0:00 0:01 0:02 0:02 0:03` | `sections/video.jsx:41-99` (quarter ticks rounded to whole seconds) | blocker |
| ex-video | format chip named after the artboard | `Reels 9:16 1080 × 1920` | `Hype trailer · 16:9 480 × 270` | `sections/video.jsx` / `video-model.js` | warning |
| ex-video | summary noun | `2 videos · about 280 MB · about 2 min in the cloud` | `1 file · about 6 MB · about 45 seconds on this Mac` | `export-copy.js:93-100` (always "files") | warning |
| ex-video | Render row (`In the cloud` / `On this Mac`) absent (local project; likely fixture) | | | `sections/video.jsx` | warning |
| ex-video | ✓ `1 artboard selected, 1 video.` (`video-copy.js:46-50`), `MP4 · GIF · Sound only · Other…`; primary `Export` follows the n = 1 rule | | | | — |
| ex-inspector | row names | `Size` W/H · `Preset: Instagram post 4:5` | `Size: Custom` · `Size: W 432 H 540` (08 calls the select "Size", 09 "Preset"; the boards disagree) | `inspector/kinds/artboard-fixed.jsx` | warning |
| ex-inspector | ✓ Export `+`, `1× · PNG · −`, `Export 1 file`, `Copy as PNG ⇧⌘C`, `Export… — every option ⇧⌘E`. Toast copy ✓ in code (`copy-png.js:29`), not captured | | | `export/inspector-export.jsx` | — |
| ex-formats | ✓ in frame: `Search formats`, Image (PNG ✓ `Transparent where empty`, JPG `Smaller, no transparency`, SVG `Shapes and text stay sharp`), Document `PDF · One page per artboard` | | | `export-copy.js:137-195` | ✓ |
| ex-formats (code) | `MP4 · GIF · WebM` is one row on the board, three rows in code | | | `export-copy.js:170-182` | warning |
| ex-formats (code) | §3 bans "workspace" | — | `Needs the render service — not configured on this workspace` | `export-copy.js:207` | warning |
| ex-formats (code) | no-results line isn't §4's pattern | `Nothing called "…". Try another word…` | `No format called that.` | `export-copy.js:139` | warning |
| ex-canvas | ✓ `Export “Matchday” — 6 artboards` · `Matchday · nothing was selected` · `Export 6 artboards` · groups `Fixed size · 2 artboards` / `Print · … Bleed + crop marks` | | | | — |
| ex-canvas | group subs lose the names | `Release plan, 4 FB event covers, the carousel…` | `On this Mac` | `sections/batch.jsx`, `batch-model.js` | warning |
| ex-canvas | Folders / Save to rows absent | `Folders: One folder` + example path · `Save to Downloads` | — | (same root as ex-social File name) | (counted) |
| ex-canvas | fold hint word | `File names, colour, per-artboard choices` | `File names, colour, per-canvas choices` on a one-canvas scope | `advanced/advanced-copy.js:5` | warning |
| ex-canvas | extra row | — | `Other format: Other…` | `sections/batch.jsx` | warning |
| ex-batch-pick | selection not carried (⌘A picked objects). `Export 5 artboards` path exists in `sheetTitle` | | `Selection —` | — | warning (unverified) |
| ex-batch | internal folder name leaks | `Export “social” — 31 canvases` | `Export “ui” — 19 artboards` + sub `ui` (the design root's `ui/` directory) | `export-sheet.jsx:259` `basename(folder)` | blocker |
| ex-batch | folder title counts artboards | `— 31 canvases` (button counts artboards) | `— 19 artboards` | `export-copy.js:51-53` | warning |
| ex-history | empty state ✓ shape (fact + verb): `No exports yet.` / `Every export of this project lands here, ready to save again.` / `Export…`. Its verb differs from the board's row action `Export again` | | | `export/exports-panel.jsx` | warning |
| ex-history | panel header lacks the folder button | `Exports` · `Open the Downloads folder` · fold | `Exports` · fold | `export/exports-panel.jsx` | warning |
| ex-share-vs | sheet heading unquoted | `Share “Combine-kampan”` | `Share Matchday` | `client/v2/share/*` | warning |
| ex-share-vs | local-project button lacks the ellipsis | `Move to cloud…` (CONTRACT §6) | `Move to cloud` (the title `Move “e2e-fixture” to the cloud?` ✓ asks with the same verb; `Only need a file? Menu › Export… ⇧⌘E` ✓) | `client/v2/share/*` | warning |
| ex-handoff | ✓ `Hand off “Matchday” to production`, `AI takes about a minute — keep working.` (`targets.js:20`), Advanced `Targets, the command, the registry file`, `Cancel · Hand off ↵` | | | `client/v2/handoff/targets.js` | — |
| ex-handoff | sub line missing | `Desktop, Tablet, Mobile · Studio design system` | none (`handoffSub` only names a DS) | `handoff/targets.js:11` | warning |
| ex-handoff | Lottie offered when nothing moves | off + `For motion — needs an animated frame; Pricing has none` | enabled `For motion` | `handoff/handoff-sheet.jsx:270-276`, server `handoff/targets.ts` | warning |
| ex-handoff | contradicts the inspector | 3 targets | extra `Design tokens · Needs a design system` while the inspector says `Uses project` | `handoff/targets.ts` | warning |
| ex-handoff-edges | the connect ask is said twice | one sheet: `Connect your Claude account to let AI draft this.` + `Handoff to production has AI write the code. Cloud doesn't include AI — use your own Claude subscription or API key.` → Connect · Cancel | outer `Hand off “Matchday” to production` › inner `Connect your Claude account?` › `Connect your Claude account to let AI draft this.` › `Claude Pro or Max / Sign in through your browser. Claude Code is set up for you.`; the "Cloud doesn't include AI" line is missing | `client/v2/ai/ConnectSheet.jsx:29-58` | warning |
| ex-handoff-edges | offline (`Queued — starts when this Mac is online`) and blockers (`The last review found 2 blockers: …`) not reached; copy ✓ in `targets.js:24-37` | | | | warning (unverified) |
| ex-offline | browser-offline doesn't trip the app's offline state; `Waits for a connection, then starts by itself.` / `Starts now. About 3 min — keep this window open until it's done.` unverified | | | `sections/video.jsx` | warning (unverified) |
| ex-huge | title/sub for the whole project | `Export everything in Alligators brand` · `93 canvases in 5 folders, plus 4 at the top level` | `Export the whole project — 19 artboards` · `Matchday` (the current canvas) | `export-copy.js:55,64-70` | blocker |
| ex-huge | big-export line | (summary only) | `This is a big export — 19 files · about 55 MB · about 6 min on this Mac. Keep this window open until it is done.` repeats the summary; "it is" vs the board's "it's" | `sections/batch-model.js:192-197` | warning |
| ex-huge | ZIP hint loses its size | `… is about 2.1 GB.` | `A ZIP keeps the canvases, assets and the design system.` | `batch-model.js:200-201` | warning |
| ex-huge | print counted in artboards | `Print · 46 pages` | `Print · 4 artboards` | `sections/batch.jsx` | warning |
| ex-huge | Include row missing | `Include: All 5 folders · test, Test2, ahoj, ahoj2` | — | `sections/batch.jsx` | warning |
| ex-print-warn | same sheet as ex-print (inherits its blockers). The fixture has no margin or font issue; the sheet copy ✓ in code (`preflight/safe-margin.js:20`, `preflight/fonts.js:25`) | | | | — |
| ex-advanced | Text note | `Or: check the fonts are embedded · turn text into shapes (print-safe).` | `Shapes print the same everywhere but can't be selected. Check fails the export if a font would not embed.` | `advanced/advanced-copy.js:33-34` | warning |
| ex-advanced | rows/values differ | Bleed field `3 mm` · `Paper: Same as artboard` · `Frame rate: 30 fps — as made` · `Bitrate: High` · `GIF colours 256` · `Long videos: Up to 3 600 frames` · colour note `(e.g. FOGRA39 or FOGRA51)` | Bleed switch · no Paper · `As made` · `Automatic` · no GIF colours / Long videos · no FOGRA example | `advanced-copy.js:35-45`, `advanced/print.jsx`, `advanced/video.jsx` | warning |
| ex-advanced | File names tokens + `The same export from a terminal` not in the frame (sheet clipped); copy ✓ in `advanced-copy.js:56-66` | | | | warning (unverified) |

## Unreachable (missing state → blocker each)

| id | what makes it reachable |
|---|---|
| ex-progress | Export jobs running in the capture lane, with a ring on the Exports icon. Needs a render stub or a seeded jobs feed. |
| ex-states | The same, plus finished, partial and no-sound jobs. Toasts are `Show in Finder`, `Retry <name>` and `Exported 114 of 115…`; the words are in `export/exports-model.js` and `done-toast.jsx`. |
| ex-handoff-ready | A finished AI handoff run (signed-in or scripted ACP). `readyTitle/readyBody` exist in `handoff/targets.js:40-60`. |
| ex-edges | A viewer session plus a live AI edit on the artboard. See the contract conflict below before building the viewer line. |

## Board vs CONTRACT (the board is stale; contract wins; not counted)

- **ex-edges.** The board says "Decided: viewing includes exporting" and hints `You can view this project. Exporting is fine…`. CONTRACT §7 Roles says **"Can view is refused every download/export on the server."** The viewer column needs redrawing as a refusal.
- **ex-states / ex-history.** "Retry Recap waits for the music … then renders by itself." §4 [C20] says a retry is pressed by hand, never automatic. The wording needs to say it waits for a press after the sync.
- **ex-advanced.** `Up to 3 600 frames` should be "3,600 frames" (C22). 08 ak-warnings has the same problem (`3600`).
- **ex-inspector vs 08 ak-social.** The size select is called `Preset` on one board and `Size` on the other. Pick one word.

## Root causes (hit several artboards)

1. **`selectionLabel` is never supplied.** Every one-artboard sheet titles itself `Export 1 artboard` (`export-sheet.jsx:95,255-261`). This hits ex-social, ex-print, ex-web, ex-video, ex-offline and 07 ve-export.
2. **The sheet has no per-selection facts.** Paper, back page and bleed mm never arrive, so you get "Drawing the page…", "colour runs past the cut" and no back-page row. Video music and caption facts never arrive either, so the sound and captions rows are static and the strip is empty. Quality is computed from the artboard px (`sections/video.jsx`, `preflight/use-preflight.js`).
3. **File name / Save to / Folders moved into Advanced.** The board keeps them in the body on every sheet.
4. **Scope names come from paths.** Folder = `basename(folder)` → `ui`. The project title is the generic `the whole project` and the sub is the current canvas (`export-sheet.jsx:259`, `export-copy.js:55-70`).

## Verdict

```json
{"canvas":"09 Export","critic":"copy-critic","blockers":16,"warnings":34,"verified_ids":["ex-formats·light","ex-formats·dark"]}
```
