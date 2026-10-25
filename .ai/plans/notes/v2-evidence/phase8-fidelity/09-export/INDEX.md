# Phase 8 fidelity — 09 Export (stage A evidence)

Branch p8-fid-g3 from feat/maude-v2 6d780ab1b. SPEC = the board artboard rendered from a scratch copy of this repo's .design (capture origin, camera pinned to 100%; the Stage's note strip is cropped off the pair for 1440×900 stages). IMPL = the release-built v2 client in Playwright Chromium (1440×900 viewport) with a window.__TAURI__ stub, throwaway HOME/XDG, claude stubbed signed-out.

**Themes.** None of 07/08/09 draws a dark artboard: every artboard is a light-pinned `<Stage>`. The "dark" SPEC half is the same board with the host's dark tokens applied (the canvas shell re-themes un-pinned artboards by default), so it is NOT a designed dark state; judge dark IMPL against the app's own dark tokens, not against it.

**Fixtures (impl).** The spec boards are drawn on the Alligators brand canvases. The impl side uses the e2e fixture project + this repo's Alligators Recruiting Trailer (24-beat real cut) + a small mixed-kind "Matchday" canvas (social post+story, web page, 2 print A6, 16:9 video) made for this pass. So content, artboard counts (6 vs 21) and canvas counts (13 vs 93) differ by construction, and the video fixtures' footage is absent ("Missing — no device has it"). (fixture) marks a difference caused only by that.

Pair image: `09-export/<id>-<theme>.jpg` (spec left, impl right; label strip "<id> · <theme>"). Full size: see full-size-path.txt.

| artboard id | theme | state | how reached | impl reachable? | first-glance differences |
|---|---|---|---|---|---|
| ex-social | light | A social post → PNG or JPG | select the post, ⇧⌘E | yes | Spec: sheet "Export “DOMA · Post 4:5 — feed matchday”" with a 1080×1350 preview, PNG/JPG/Other…, Size 1× 1080×1350 / 2× 2160×2700, Annotations, File name field, Save to Downloads, "1 file · about 1.4 MB · a second". Impl: "Export 1 artboard" sheet with no preview, no File name / Save to (under Advanced), size chips 1× 2× without pixel dimensions, plus a Scope row (Selection/This canvas/Folder/Whole project). |
| ex-social | dark | A social post → PNG or JPG | select the post, ⇧⌘E | yes | as light (spec dark = host re-theme, not drawn) |
| ex-print | light | A print artboard → Print PDF, on paper | select the A6 print artboard, ⇧⌘E | yes | Spec: preview with bleed + crop marks, page strip (Page 1 of 2 · A6 · 105×148 mm · Bleed 3 mm · Cut), Print PDF/PDF/PNG, Bleed, Crop marks, Add “B · zadní (FLAG)” page, File name, Save to, "1 PDF · 2 pages". Impl: preview pane is an empty placeholder "Drawing the page…", Bleed + Crop marks only (no back-page row), no page strip, no File name / Save to. |
| ex-print | dark | A print artboard → Print PDF, on paper | select the A6 print artboard, ⇧⌘E | yes | as light (spec dark = host re-theme, not drawn) |
| ex-web | light | A web artboard → full page, or PDF | select the web artboard, ⇧⌘E | yes | Spec: web artboard sheet (full page or PDF). Impl: web sheet captured with Advanced still open from the previous step (scale, colour, file names, terminal command) so it is taller than the spec. |
| ex-web | dark | A web artboard → full page, or PDF | select the web artboard, ⇧⌘E | yes | as light (spec dark = host re-theme, not drawn) |
| ex-video | light | A video artboard → MP4, GIF or sound, with a filmstrip | select the video artboard, ⇧⌘E | yes | Spec: format tiles with a filmstrip. Impl: Formats list with one chip, MP4/GIF/Sound only/Other…, Quality 1080p/4K, Sound note, Captions, a time strip (0:00–0:07); Advanced open; no cloud-vs-Mac cards. |
| ex-video | dark | A video artboard → MP4, GIF or sound, with a filmstrip | select the video artboard, ⇧⌘E | yes | as light (spec dark = host re-theme, not drawn) |
| ex-inspector | light | No sheet at all — the inspector with an artboard selected | select the post, inspector open | yes | Spec: floating compact inspector with the Export row + "Copy as PNG". Impl: docked full-height inspector, Export row = 1× PNG selects + "Export 1 file" button, Copy as PNG ⇧⌘C, Export… ⇧⌘E. Same rows, different chrome. |
| ex-inspector | dark | No sheet at all — the inspector with an artboard selected | select the post, inspector open | yes | as light (spec dark = host re-theme, not drawn) |
| ex-formats | light | Other… — every format, one list away | click Other… | yes | Spec: the Other… list of every format. Impl: a menu with search "Search formats", sections Image (PNG ✓, JPG, SVG) and Document (PDF, Print PDF…), clipped by the window bottom. |
| ex-formats | dark | Other… — every format, one list away | click Other… | yes | as light (spec dark = host re-theme, not drawn) |
| ex-canvas | light | ⇧⌘E with nothing selected → this canvas | deselect, ⇧⌘E | yes | Spec: "Export “Combine-kampan” — 21 artboards": per-kind rows with thumbnail strips (PNG·2×), "Folders: One folder", Save to Downloads, "21 files · about 140 MB". Impl: "Export “Matchday” — 6 artboards" with per-kind rows (Fixed size · 2 … Video · 1) each a format select; no thumbnail strips, no Folders / Save to; type smaller. |
| ex-canvas | dark | ⇧⌘E with nothing selected → this canvas | deselect, ⇧⌘E | yes | as light (spec dark = host re-theme, not drawn) |
| ex-batch-pick | light | Five artboards, two kinds | ⌘A then ⇧⌘E | partially — all artboards of a 6-artboard mixed canvas | Spec: five artboards of two kinds selected. Impl: ⌘A + ⇧⌘E lands on the canvas-scope sheet (6 artboards) — the selection was not carried (Scope: "Selection —"). |
| ex-batch-pick | dark | Five artboards, two kinds | ⌘A then ⇧⌘E | partially — all artboards of a 6-artboard mixed canvas | as light (spec dark = host re-theme, not drawn) |
| ex-batch | light | Export a folder — grouped by kind | Folder scope | partially — folder scope if the chip exists | Spec: folder export grouped by kind. Impl: the same canvas-scope sheet; the Folder chip was not applied. |
| ex-batch | dark | Export a folder — grouped by kind | Folder scope | partially — folder scope if the chip exists | as light (spec dark = host re-theme, not drawn) |
| ex-progress | light, dark | 10 · Rendering in the cloud — keep working | — | **no** — a running cloud render / this-Mac render with a ring on the Exports icon: no export job runs in the browser lane | spec only: `ex-progress-light-spec-only.jpg` |
| ex-states | light, dark | 11 · Cloud or this Mac, done, partly done | — | **no** — Cloud / this Mac / done / partly done states: need running or finished export jobs | spec only: `ex-states-light-spec-only.jpg` |
| ex-history | light | Exports panel — again, open folder, retry | ⌘K › Exports | partially — empty (no jobs run in the browser lane) | Spec: Exports panel with rows (again / open folder / retry). Impl: panel top-right "No exports yet" — no jobs ran, row layout not observable. |
| ex-history | dark | Exports panel — again, open folder, retry | ⌘K › Exports | partially — empty (no jobs run in the browser lane) | as light (spec dark = host re-theme, not drawn) |
| ex-share-vs | light | Share link vs Export | the Share button | partially — the Share panel only; the Export-points-at-Share hint needs a project with people in it | Spec: Share link vs Export side by side. Impl: the Share button opened the Claude connect sheet (fixture has no share path), not a Share panel — the comparison copy was not reached. |
| ex-share-vs | dark | Share link vs Export | the Share button | partially — the Share panel only; the Export-points-at-Share hint needs a project with people in it | as light (spec dark = host re-theme, not drawn) |
| ex-handoff | light | ⇧⌘H — pick where the code goes | ⇧⌘H | yes | Spec: radio cards with icons per target (Studio web · Last used / Studio app / Lottie animation), "Use the design system" checkbox, "Last review: no blockers. AI takes about a minute — keep working.", Advanced, Hand off. Impl: plain listbox (Web / App / Lottie animation / Design tokens "Needs a design system"), no radios or icons, no "Use the design system" checkbox, same AI note; a heavy blue focus ring around the whole dialog. |
| ex-handoff | dark | ⇧⌘H — pick where the code goes | ⇧⌘H | yes | as light (spec dark = host re-theme, not drawn) |
| ex-handoff-ready | light, dark | 15 · Ready — one thing to copy; Advanced shows the rest | — | **no** — the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out) | spec only: `ex-handoff-ready-light-spec-only.jpg` |
| ex-handoff-edges | light | Handoff without AI, offline, or with review blockers | click Hand off with claude signed out | partially — the signed-out path; offline and blockers not driven | Spec: three variants (no AI / offline / review blockers). Impl: with claude signed out the sheet is replaced by "Connect your Claude account?" (Claude Pro or Max) — the no-AI state exists; the other two were not reached. |
| ex-handoff-edges | dark | Handoff without AI, offline, or with review blockers | click Hand off with claude signed out | partially — the signed-out path; offline and blockers not driven | as light (spec dark = host re-theme, not drawn) |
| ex-offline | light | Offline — this Mac renders, the cloud waits | browser context offline, same sheet | partially — browser-level offline only; the app’s own offline detection may not trip | Spec: banner that the cloud waits while this Mac renders. Impl: browser-level offline does not change the sheet; no offline banner. |
| ex-offline | dark | Offline — this Mac renders, the cloud waits | browser context offline, same sheet | partially — browser-level offline only; the app’s own offline detection may not trip | as light (spec dark = host re-theme, not drawn) |
| ex-huge | light | Whole project, chosen in Scope | sheet open, Whole project scope | partially — 13 canvases, not 93 / 524 artboards | Spec: whole project, 524 artboards / 93 canvases grouped by kind with a size warning. Impl: Whole project = 19 artboards, same grouped rows (13 canvases, fixture); a yellow bar warns about file count. |
| ex-huge | dark | Whole project, chosen in Scope | sheet open, Whole project scope | partially — 13 canvases, not 93 / 524 artboards | as light (spec dark = host re-theme, not drawn) |
| ex-print-warn | light | Past the safe margin; a font that won’t embed | same sheet — the preflight warnings | partially — same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning) | Spec: safe-margin overflow and a non-embeddable font warning in the sheet. Impl: same sheet as ex-print; the warning shows on the artboard label and the inspector ("1 px wider than A6 …") but not in the sheet. |
| ex-print-warn | dark | Past the safe margin; a font that won’t embed | same sheet — the preflight warnings | partially — same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning) | as light (spec dark = host re-theme, not drawn) |
| ex-edges | light, dark | 20 · A viewer exports; AI is still changing it | — | **no** — viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit | spec only: `ex-edges-light-spec-only.jpg` |
| ex-advanced | light | Export › Advanced, per kind | open the sheet, open the Advanced fold | yes | Spec: Export › Advanced per kind (Scale/dpi, Exact scale, Colour profile, Background; Print: images, text, bleed, crop marks, registration; Video: frame rate, codec, bitrate, render service). Impl: the Advanced region of the canvas-scope sheet shows all of these in a two-column grid — structure matches; type is small and the sheet clips at the window bottom. |
| ex-advanced | dark | Export › Advanced, per kind | open the sheet, open the Advanced fold | yes | as light (spec dark = host re-theme, not drawn) |

## Coverage

- artboards on the board: 21
- pair images (id × theme): 34
- artboards with no impl frame (spec-only): 4 — ex-progress, ex-states, ex-handoff-ready, ex-edges

## After stage C (C4-export)

Pairs in this folder were re-shot after the fixes (light + dark); per-id status and what is still open: see `fix-export.md`.

## After — stage C round 2 (p8-c2-insptl)
Pairs re-shot light + dark on branch p8-c2-insptl. Changed: ex-batch / ex-batch-pick / ex-huge (kind rows carry artboard stills from the new `POST /_api/export-preview`). Unreachable: ex-progress, ex-states, ex-handoff-ready, ex-edges. Details: `08-artboard-kinds/fix-insptl.md`.

## After (stage D, 6d19daa9a) — p8-d-g3

Re-shot on the stage C round 2 tip (feat/maude-v2 6d19daa9a), release-built client, 1440×900 Chromium, throwaway HOME/XDG, claude stubbed signed-out. No product code touched. Evidence only — match / mismatch is judged by the critic re-check. Pairs: `<id>-<theme>.jpg` here (spec left, impl right); full size: `full-size-path.txt`.

**SPEC side: re-rendered (all 21 artboards, both themes).** `09 Export.tsx` changed after the stage A shot (commit 2220acc81 — ex-states caption "is yours to press", ex-share-vs now says Can comment may download / Can view sees no Export, ex-advanced "Up to 3,600 frames"), so the whole board was rendered again from a scratch copy of `.design`.

**IMPL side, per artboard id × theme (light, dark):**

| artboard id | after (stage D) |
|---|---|
| ex-inspector, ex-social, ex-formats, ex-advanced, ex-web, ex-print, ex-print-warn, ex-video, ex-canvas, ex-batch-pick, ex-batch, ex-huge, ex-history, ex-share-vs, ex-offline | re-shot, light + dark |
| ex-handoff | re-shot, light + dark — the stage C dark pair showed no sheet (⇧⌘H missed focus); the scenario now falls back to ⌘K › Hand off when the chord does not open it, so both themes show the sheet |
| ex-handoff-edges | re-shot, light + dark — click "Hand off" with claude signed out; the sheet settles (3.5 s) to its title with an empty body |
| ex-progress, ex-states | re-shot, light + dark — NEW this stage (unreachable in stage A/C). The job LIST is seeded by a Playwright route intercept on `GET /_api/export-jobs` (a running cloud MP4 at 16 of 25, a queued this-Mac MP4, a done PNG, a 114-of-115 partial in the shapes `test/exports-panel.test.tsx` uses); the Exports panel, rows and the ring on the Exports icon are the real client. No render runs |
| ex-handoff-ready | unreachable — needs a finished AI handoff run; claude is stubbed signed-out. Spec only |
| ex-edges | unreachable — needs a viewer-role session / a live AI edit on the artboard. Spec only |

Harness notes: the What's New panel opens over a fresh project and is now closed by `run.mjs` before shooting.

## After (round 4, p8-c4-kindsexport) — batch kind rows, print strip, toast, titles

Re-shot light + dark with the committed stage-D harness (`_d-harness-g3`, t09). Pairs overwritten in this folder.

| artboard id | after (round 4) |
|---|---|
| ex-canvas, ex-batch-pick, ex-batch, ex-huge | each kind row = icon tile · title + names · artboard stills (right) · format select with its small note ("Bleed + crop marks" / "In the cloud") under it; no "Other format" / "Annotations" rows (under Advanced); Folders is a select with the path under it; Print counts pages ("Print · 2 pages"); the whole-project title names the project like the project pill ("Export everything in <project>") |
| ex-print, ex-print-warn | title "Export “…” + its back", summary "1 PDF · 2 pages · …", the page strip is 34 × 47 thumbnails between ‹ › |
| ex-inspector | the "Copied … as a PNG" pill is one line (fit-content), still bottom-docked |
| ex-video, ex-offline | unchanged: the filmstrip's clip stills / names / music bed and the cloud / this-Mac render cards are open (see fix-c4-kindsexport.md) |
| ex-advanced, ex-formats, ex-history, ex-share-vs | unchanged this round (open) |

## FINAL (stage D2, d3881fe41) — p8-d2-g3

Every reachable id re-shot on the merged tip (release-built client, Google Chrome channel for H.264, light + dark), IMPL side only; spec frames reused from stage D (the board .tsx files and .design are byte-identical to the stage-D copy: `git diff 6d19daa9a HEAD -- .design` is empty). No match/mismatch judged here. Pairs: full-size-path.txt (last line).

| artboard id | light | dark |
|---|---|---|
| ex-social | re-shot | re-shot |
| ex-print | re-shot | re-shot |
| ex-web | re-shot | re-shot |
| ex-video | re-shot | re-shot |
| ex-inspector | re-shot | re-shot |
| ex-formats | re-shot | re-shot |
| ex-canvas | re-shot | re-shot |
| ex-batch-pick | re-shot (all artboards of a 6-artboard mixed canvas) | re-shot (all artboards of a 6-artboard mixed canvas) |
| ex-batch | re-shot (folder scope if the chip exists) | re-shot (folder scope if the chip exists) |
| ex-progress | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) |
| ex-states | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) |
| ex-history | re-shot (empty (no jobs run in the browser lane)) | re-shot (empty (no jobs run in the browser lane)) |
| ex-share-vs | re-shot (the Share panel only; the Export-points-at-Share hint needs a project with people in it) | re-shot (the Share panel only; the Export-points-at-Share hint needs a project with people in it) |
| ex-handoff | re-shot | re-shot |
| ex-handoff-ready | unreachable — the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out) | unreachable — the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out) |
| ex-handoff-edges | re-shot (the signed-out path; offline and blockers not driven) | re-shot (the signed-out path; offline and blockers not driven) |
| ex-offline | re-shot (browser-level offline only; the app’s own offline detection may not trip) | re-shot (browser-level offline only; the app’s own offline detection may not trip) |
| ex-huge | re-shot (13 canvases, not 93 / 524 artboards) | re-shot (13 canvases, not 93 / 524 artboards) |
| ex-print-warn | re-shot (same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning)) | re-shot (same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning)) |
| ex-edges | unreachable — viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit | unreachable — viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit |
| ex-advanced | re-shot | re-shot |

Totals: 38 id×theme re-shot, 4 unreachable (spec-only frames kept from stage A/D).

Harness notes (D2): ex-formats is cropped to the sheet plus the formats list (the list hangs off the sheet edge and was clipped before). ex-progress / ex-states are the real Exports panel with a seeded job list (route intercept on GET /_api/export-jobs). ex-handoff-ready and ex-edges stay unreachable (need a finished AI handoff run / a viewer session).

## FINAL (D3, 63592219a) — p8-d3-g3

Every reachable id re-shot again on the merged tip after stage C round 5 + bugs3 (release-built client, Google Chrome channel, light + dark), IMPL side only. Spec frames reused from stage D (the board 09 .tsx/.css last changed in 2220acc81, before the stage-D spec shot). No match/mismatch judged here. Pairs: full-size-path.txt (last line, "final (D3)").

| artboard id | light | dark |
|---|---|---|
| ex-social | re-shot | re-shot |
| ex-print | re-shot | re-shot |
| ex-web | re-shot | re-shot |
| ex-video | re-shot | re-shot |
| ex-inspector | re-shot | re-shot |
| ex-formats | re-shot | re-shot |
| ex-canvas | re-shot | re-shot |
| ex-batch-pick | re-shot (all artboards of a 6-artboard mixed canvas) | re-shot (all artboards of a 6-artboard mixed canvas) |
| ex-batch | re-shot (folder scope if the chip exists) | re-shot (folder scope if the chip exists) |
| ex-progress | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) |
| ex-states | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) |
| ex-history | re-shot (empty (no jobs run in the browser lane)) | re-shot (empty (no jobs run in the browser lane)) |
| ex-share-vs | re-shot (the Share panel only; the Export-points-at-Share hint needs a project with people in it) | re-shot (the Share panel only; the Export-points-at-Share hint needs a project with people in it) |
| ex-handoff | re-shot | re-shot |
| ex-handoff-ready | unreachable — the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out) | unreachable — the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out) |
| ex-handoff-edges | re-shot (the signed-out path; offline and blockers not driven) | re-shot (the signed-out path; offline and blockers not driven) |
| ex-offline | re-shot (browser-level offline only; the app’s own offline detection may not trip) | re-shot (browser-level offline only; the app’s own offline detection may not trip) |
| ex-huge | re-shot (13 canvases, not 93 / 524 artboards) | re-shot (13 canvases, not 93 / 524 artboards) |
| ex-print-warn | re-shot (same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning)) | re-shot (same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning)) |
| ex-edges | unreachable — viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit | unreachable — viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit |
| ex-advanced | re-shot | re-shot |

Totals: 38 id×theme re-shot, 4 unreachable (spec-only frames kept).

Harness notes (D3): the D2 harness plus the bugs3 deltas, repointed (the Export sheet for one element names it — "Export “Zápas · post 4:5”" — because the harness selects the artboard by its label chip). ex-formats-dark timed out on its first dark run (click on Other… after a slow open) and was re-run once; the frame kept is from the re-run. ex-progress / ex-states are the real Exports panel with the seeded job list (route intercept on GET /_api/export-jobs). ex-handoff-ready and ex-edges stay unreachable (need a finished AI handoff run / a viewer session).

## FINAL (D4, 21c9714cf) — p8-d4-g3

Every reachable id re-shot again on the merged tip after stage C round 6 (release-built client, Google Chrome channel, light + dark), IMPL side only. Spec frames reused from stage D (the board 09 .tsx/.css last changed in 2220acc81, before the stage-D spec shot). No match/mismatch judged here. Pairs: full-size-path.txt (last line, "final (D3)").

| artboard id | light | dark |
|---|---|---|
| ex-social | re-shot | re-shot |
| ex-print | re-shot | re-shot |
| ex-web | re-shot | re-shot |
| ex-video | re-shot | re-shot |
| ex-inspector | re-shot | re-shot |
| ex-formats | re-shot | re-shot |
| ex-canvas | re-shot | re-shot |
| ex-batch-pick | re-shot (all artboards of a 6-artboard mixed canvas) | re-shot (all artboards of a 6-artboard mixed canvas) |
| ex-batch | re-shot (folder scope if the chip exists) | re-shot (folder scope if the chip exists) |
| ex-progress | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) |
| ex-states | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) | re-shot (job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs) |
| ex-history | re-shot (empty (no jobs run in the browser lane)) | re-shot (empty (no jobs run in the browser lane)) |
| ex-share-vs | re-shot (the Share panel only; the Export-points-at-Share hint needs a project with people in it) | re-shot (the Share panel only; the Export-points-at-Share hint needs a project with people in it) |
| ex-handoff | re-shot | re-shot |
| ex-handoff-ready | unreachable — the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out) | unreachable — the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out) |
| ex-handoff-edges | re-shot (the signed-out path; offline and blockers not driven) | re-shot (the signed-out path; offline and blockers not driven) |
| ex-offline | re-shot (browser-level offline only; the app’s own offline detection may not trip) | re-shot (browser-level offline only; the app’s own offline detection may not trip) |
| ex-huge | re-shot (13 canvases, not 93 / 524 artboards) | re-shot (13 canvases, not 93 / 524 artboards) |
| ex-print-warn | re-shot (same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning)) | re-shot (same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning)) |
| ex-edges | unreachable — viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit | unreachable — viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit |
| ex-advanced | re-shot | re-shot |

Totals: 38 id×theme re-shot, 4 unreachable (spec-only frames kept).

Harness notes (D4): the D3 harness (`_d3-harness-g3/`) plus the round-6 mini scenarios (`t08c`/`t09c`, for reference; the full `t09` was run and needed no scenario changes), repointed to worktree wf_74ac1088-f6f-11 (branch p8-d4-g3, tip 21c9714cf), Google Chrome channel, release-built client. Spec frames reused unchanged (the `09` board last changed on 2026-10-22 or earlier, before the stage-D spec shots).

## Round 6 (p8-c6-bugs4) — after

| id | after | notes |
|---|---|---|
| ex-social | re-shot, light + dark | mini scenario `t09c`. The size chip / size line read 432 × 540 in both themes (the render worker's artboard harvest measured the bordered frame: 436 × 544 in dark); the preview tile fills ~0.8 s after the sheet opens in both themes (the earlier empty dark tile was a 1.1 s shot) |
