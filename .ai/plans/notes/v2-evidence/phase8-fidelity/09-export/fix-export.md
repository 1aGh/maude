# 09 Export — stage C fix (C4-export), done vs open

Branch `p8-c-export` (from feat/maude-v2 04ec582a3). Commits: b29a20d6a · fceb99aba · 4f7148758 · 2220acc81 (+ the evidence commit).
Verified: tsc clean, biome (warnings only, none new of note), export / handoff / selection / estimate / preflight / file-name suites green via the lane (one 5 s timeout flake on a run that shared the machine with tsc passed alone), `check-client-boots-source` OK, `opening-card-clears` PASS.

## Done (red → green where behaviour changed)

| what | tests |
|---|---|
| The title names the one artboard (selection label from the canvas, else the estimate's own label); sub says where it sits ("canvas · project", "print") | `selection-scope.test.ts`, `v2-export-sheet.test.tsx` |
| ⌘A / ⇧-click multi-selection reaches Scope: the canvas's list entries carry no `file`, the shell now stamps the open canvas (`stampSelectionFile`, `use-canvas-bridge.jsx`) | `selection-scope.test.ts` (red: export missing) |
| Folder = "Export “social” — 31 canvases" (own name, `ui/` is not a name); whole project = "Export everything in <project>" + "93 canvases in 5 folders, plus 4 at the top level" | `v2-export-sheet.test.tsx` |
| Estimate now also returns `boards` (artboards reached: label/kind/w/h) and `canvasCounts` (additive) | `export-estimate.test.ts` |
| Print paper no longer waits on the headless safe-margin render (25 s in a lane with no browser): `POST /_api/export-preflight {measure:false}` answers paper/back/fonts at once, the margin follows. So the preview draws, the back-page check appears, "Page 1 of 2 · A6 · 105 × 148 mm" | `export-preflight.test.ts`, `v2-export-print.test.tsx` (red: timed out on revert) |
| Preview column for image / web / video / print: the artboard's real picture (a small capture through the canvas bridge, sanitised like a download) + size line; web has the dashed first screen | `v2-export-sheet.test.tsx` (structure), live shots |
| Size chips carry pixels (1× 1080 × 1350); web Area row is a Seg with sizes | tests above |
| File name (typed name for one file, "and N more" for several) + Save to rows; Save to rides `options.saveTo` (Downloads / Ask each time); batch gets a Folders row | `v2-export-sheet.test.tsx` |
| Footer anatomy: summary right-aligned above the rule, `› Advanced <hint>` left, Cancel + verb right (no download icon); open Advanced body scrolls inside the sheet, the footer never leaves the window | `v2-export-batch.test.tsx` (closed state), sheet test |
| Aspect ratios keep their numbers in file names ("Post 4-5", not "Post 45") | `export-file-names.test.ts` |
| Video: 1080p / 4K name a size (shorter side), 4K greys when the comp is too small; Sound is a switch with a true note; Captions row draws all four; ticks are whole seconds (0:00 0:05 0:10 0:15), no repeats | `v2-export-video.test.tsx` |
| Batch kind rows: icon tile, names line ("from N canvases — a, b, c…"), where it renders | live shots |
| Web code line: icon + link + ⇧⌘H together | live shots |
| Formats (Other…) menu: one line per row, ✓ leading, reason right-aligned, semibold group heads, 380 wide | live shots |
| Handoff: radio cards (dot + glyph + title), ← ↑ → ↓ move and pick (off targets skipped), focus lands on the picked card and the dialog root has no ring, Advanced in the footer row | `v2-handoff-sheet.test.tsx` |
| Board text vs CONTRACT (decision `v2-8.5-contract-over-board`): ex-edges left column is Can comment (Can view is refused every export, §7), Retry is pressed by hand (C20), "3,600" (C22) | board file |

## Open (not fixed) and why

- **Picture-dependent content**: filmstrip clip stills + names + title lane (server `StripClip` has no names/pictures — needs a per-artboard/clip picture source), thumbnail stacks on batch rows, format-tile shape pics. Needs a route (`POST /_api/export-preview` over `thumb`) = patch request below.
- **Web "Visible area"**: drawn, held back (disabled). The exporter has no first-screen crop (`region` is a world rect and the client doesn't know the artboard's x/y).
- **Captions "As a file" / "Both"**: drawn, disabled with the reason. Needs a caption-file writer in the exporter.
- **Sound switch** is read-only (the engine mixes the timeline; no mute option).
- **Folders "One per canvas"**: file names cannot contain `/`, so only "One folder" exists (engine work).
- **Advanced fold content**: Paper row, GIF colours, Long videos "Up to 3,600 frames", Frame rate "30 fps — as made", Bitrate "High", Codec select, exact-scale "2.5×" field, FOGRA example, the text note copy — not done (some need spec options).
- **Kit primitives owned by C1-kit**: seg accent ring (R3), sheet/dialog material + title weight (R2/R4), styled selects (R9), switch / checkbox off edge (R6), fold-row look. Not touched here to avoid a clash; the sheet uses the shared classes.
- **ex-inspector**: full-width Export button with icon, kbd chips, styled preset selects (C2/C1 share the inspector chrome).
- **ex-history**: header folder button, top-bar Exports icon while empty.
- **ex-handoff-edges**: connect step is `ConnectSheet` (C6's "Connect sheet centred modal"); no nested double frame fix here.
- **ex-handoff**: Lottie off-reason for a still frame / "Design tokens" extra row (server `handoff/targets.ts`); sub line "Desktop, Tablet, Mobile · design system"; review hint icon.
- **ex-print-warn**: the in-sheet safe-margin / font warning rows exist in code; they need the headless measure (agent-browser) which the lane lacks — not shot.
- **Unreachable states (no stub built)**: ex-progress, ex-states (running/finished/partial jobs — seed `GET /_api/export-jobs`), ex-handoff-ready (finished AI run), ex-edges (viewer role + live AI edit), ex-offline (needs a cloud-capable estimate: `render.cloud:true` — a Playwright route override of `/_api/export-estimate` would do). Plan: intercept those endpoints in the harness (page.route) — not done in this run.

## Stage D (re-shoot)

Re-shot with the stage-A harness (`.scr/t09.mjs`, scratch, not committed), light + dark, pairs overwritten in this folder. Per id × theme:
- **fixed or much closer (still differs in the open items above)**: ex-social, ex-print, ex-web, ex-video, ex-canvas, ex-batch-pick, ex-batch, ex-huge, ex-formats, ex-advanced, ex-handoff (light shot taken by hand: the scripted ⇧⌘H missed focus in the full run; the dark pair still shows no sheet).
- **unchanged / not re-checked**: ex-inspector, ex-history, ex-share-vs, ex-handoff-edges, ex-offline, ex-print-warn.
- **unreachable**: ex-progress, ex-states, ex-handoff-ready, ex-edges (spec-only).
Nothing is "matches" yet; the lead's critic re-check decides.

## Patch requests

- `http.ts` / `routes/export.ts` deps: inject `thumb: (req) => thumbSvc.thumb(req)` and add `POST /_api/export-preview` (+ writer-registry, `_acl-route-classes`, `_role-refusals` entries) for clip/artboard pictures (filmstrip stills, batch thumbnail stacks).
- `shell/icons.jsx` (C1): add `chevron`, `corner`, `done`, `view`, `minus`, `spark` glyphs; the export code draws its own meanwhile.

## Decisions

- `decision:maude/v2-p8-c4-preflight-two-phase` — the preflight answers paper/back/fonts without the safe-margin render (`measure:false`), then the full answer replaces it. Rejected: shortening the 25 s render timeout (still blank for seconds), drawing a fake paper.
- `decision:maude/v2-p8-c4-preview-by-canvas-capture` — the preview picture is a small capture through the existing canvas bridge, sanitised like a download. Rejected: a new server picture route now (shared route tables, handed back), live-rendering the artboard in the shell (cross-origin canvas).
- `decision:maude/v2-p8-c4-quality-names-a-size` — 1080p / 4K are the shorter side, scale derived (clamped 0.25–4), 4K greyed when it would equal 1080p. Rejected: renaming the chips to "1×/2×" (board names them).
- `decision:maude/v2-p8-c4-save-to-in-spec` — the sheet always sends `options.saveTo` (default Downloads) because it now says where the file lands; absent meant "ask" on desktop. Rejected: showing "Downloads" with no spec field (a lie on desktop).
- `decision:maude/v2-p8-c4-held-back-controls` — controls the engine cannot honour (Visible area, caption file, Both) are drawn disabled with a reason, not faked.
