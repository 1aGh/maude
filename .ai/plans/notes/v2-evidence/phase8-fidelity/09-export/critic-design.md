# design-critic — 09 Export · V2-8.5 stage B

_2026-10-22 · board `.design/ui/v2/09 Export.tsx` (+ `09 Export.css`, `_kit.css`) · pairs from `09-export/INDEX.md`, full-size frames read for all light ids. Read-only review: nothing was edited and no server was booted._

Lens: layout, spacing, sizes, typography, colour/tokens, material, iconography, and every drawn state. Spec "dark" is the host re-theme of a light-pinned board (INDEX), so dark IMPL is judged against the DS's own dark ladder (`colors_and_type.css` dark block, mirrored in `styles/1-tokens-maude-v2.css:150+`). Anything caused only by the fixture (counts, names, footage, comp size, no DS in the fixture) is marked *(fixture)* and is not a finding.

## R — root causes (they hit several artboards; rows below cite them as R1–R8)

| # | root cause | spec | impl | owner |
|---|---|---|---|---|
| R1 | **The shell still runs on the v1 `.maude` token ladder.** The v2 tokens are scoped to `.maude-v2[data-theme]`, and the shell file only *adds* tokens the v1 ladder lacks ("Never overrides a shell token"). So every sheet renders with the v1 accent, radii, type and surfaces. | `--accent` oklch(0.53 0.175 **238**) azure · radius-md/lg/xl 10/14/**20** · type-md **17**/1.40 · font-body system-ui · dark bg-2 0.275 | accent oklch(0.52 0.195 **268**) indigo (Export / Hand off / Share / selection) · radii 7/10/14 · type-md 16/24px · Inter · dark bg-1 0.198, a near-black flat sheet | `app.jsx:2984` (`className='maude'`), `styles/1-tokens-maude.css:93-104,154-160`, `styles/1-tokens-maude-v2-shell.css:3-7` |
| R2 | The sheet's material doesn't match `.k-dialog`. | padding space-5 (20) · radius-xl · bg-2 · shadow-lg + inset 0.5px island-edge | padding space-4 (16) · radius-lg · bg-1 · shadow-md, no edge | `v2/export/export.css:17-31` |
| R3 | Segmented "on" state has no accent ring. Spec draws a white pill with a 1px azure ring; impl draws a white pill with a shadow only, so the choice reads weaker on every Seg (Scope, Format, Size, Area, Quality, Captions). | `.k-seg-b[aria-pressed]` bg-2 + shadow-sm + inset 1px accent | bg-1 + shadow-sm | `export.css:101-105` |
| R4 | Wrong title weight and size. | `.k-dialog-t` w-semibold, type-md 17, lh-md | `.ex-title` w-medium, 16 | `export.css:43-50` |
| R5 | Footer anatomy is rearranged. | Summary right-aligned *above* the footer rule; footer = `› Advanced` (semibold) + inline xs hint at the left, Cancel + primary at the right | Advanced is its own full-width row *above* the summary, hint pushed right (`margin-left:auto`), label regular; primary carries a leading download icon the board doesn't draw | `export-sheet.jsx:478-487,556-582` (`StIcon download` :573), `styles/3-kit-maude-v2.css:249` |
| R6 | No preview column. The board's `ExSheet` has a 176px bg-3 radius-lg preview with a caption (px · preset) for image, web and video. Impl sections render rows only; print has the column but stays on its pending state. | `.ex-prev` | absent | `sections/image.jsx`, `sections/web.jsx`, `sections/video.jsx` (no preview node); `sections/print.jsx:105-170` |
| R7 | **File name / Save to** (and **Folders** in batch) are missing from the sheet body on every export artboard. They only exist under Advanced › names. | `Row k="File name"` `.ex-field` (30px, bg-3) + `Row k="Save to"` select | absent | `export-sheet.jsx:439-475` (rows), `advanced/names.jsx` |
| R8 | The title never names the selection, because the shell doesn't pass `selectionLabel`. It falls back to "Export 1 artboard". The sub-line also lacks the kind or project. | `Export "DOMA · Post 4:5 — feed matchday"`, sub "LetakA6 · print" / "Homepage · Studio site" | "Export 1 artboard", sub "Matchday" | `app.jsx:3216-3240` (prop never passed), `export-copy.js:43-46,64-70` |
| R9 | Native `<select>` with OS chevrons where the board draws the styled `select k-in-select` (bg-3 well, 12px chevron). | k-in-select | native select | `advanced/fields.jsx:10`, `inspector-controls.jsx:506` |

## Per artboard

**ex-social** (L, D)
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | title / sub | quoted artboard name | "Export 1 artboard" / "Matchday" | R8 | blocker |
| L+D | preview column 136×170 + caption "1080 × 1350 · Post 4:5" | drawn | absent | R6 · `sections/image.jsx` | blocker |
| L+D | Size seg quiet px | `1× 1080 × 1350` · `2× 2160 × 2700` (`<small>`) | `1×` `2×` only | `sections/image.jsx:62-73`, `export-copy.js IMAGE_SIZES` | blocker |
| L+D | File name + Save to rows | drawn | absent | R7 | blocker |
| L+D | seg on-state, sheet material, title weight, footer | k-dialog / k-seg-b | see R2–R5 | R2–R5 | blocker |
| L+D | accent hue + dark surfaces | azure 238; dark bg-2 0.275 | indigo 268; dark bg-1 0.198 | R1 | blocker |
| L+D | summary copy | "… · a second" | "… · a few seconds on this Mac" | `export-copy.js summaryWords` | warning |
| L+D | sheet width | 660 | 680 | `export.css:23` | warning |

**ex-print** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | preview stuck on pending | paper with crop marks, bleed tint, stacked back page, page strip (34×47 thumbs), "Page 1 of 2 · A6 · 105 × 148 mm", legend | blank page + "Drawing the page…" (preflight never resolved) | `sections/print.jsx:155-170`, `preflight/use-preflight.js:26-57` | blocker |
| L+D | "Add “B · zadní (FLAG)”" back-page check | 3rd check in Print | absent (depends on preflight `back`) | `sections/print.jsx:43,204-211` | blocker |
| L+D | Bleed sub | "colour runs 3 mm past the cut" | "colour runs past the cut" (mm unknown until preflight) | `sections/print-copy.js:21` | warning |
| L+D | title "+ its back", sub "LetakA6 · print" | drawn | generic | R8 | blocker |
| L+D | File name / Save to | drawn | absent | R7 | blocker |
| L+D | width 780, preview 300 | — | 780, preview column bg-1 not bg-3 | `export.css` print block / `print.css` | warning |
| L+D | R1–R5 | | | | blocker |

**ex-web** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Area is a Seg `Full page 1440 × 3120 / Visible area 1440 × 900` | Seg | plain text "Full page" + note | `sections/web.jsx:64-66` | blocker |
| L+D | long-page preview (fold dashed) + caption | drawn | absent | R6 | blocker |
| L+D | Code line | `corner` icon (14, fg-2) + "Code for a developer?" … link + `Kbd` chip, link and kbd adjacent at the right, inside the rows column | no icon, link centred (the two `margin-left:auto`), kbd is plain xs text, full sheet width | `sections/web.jsx:97-108`, `export.css:298-303,333-351` | blocker |
| L+D | File name / Save to, title/sub | drawn | absent / generic | R7, R8 | blocker |
| L+D | R1–R5 | | | | blocker |

**ex-video** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | frame preview (still + scrub chip) + "Frame at 0:04" | drawn | absent | R6 | blocker |
| L+D | Formats tiles show a shape thumb | `.ex-shape-pic` | text only | `sections/video.jsx` formats | warning |
| L+D | Sound row | switch (on) + note | plain text, no switch | `sections/video.jsx:214-220` | blocker |
| L+D | Captions | Seg Burned in / As a file / Both / Off, note inline | Off / Burned in; note wraps below (`.ex-row-n--in` is not defined in the impl CSS) | `sections/video.jsx:222-243`, `export.css` (missing rule) | blocker |
| L+D | Render row: two radio cards (In the cloud / On this Mac, icon + sub) | drawn | absent (`choice.show` false in this lane) | `sections/render-row.jsx:22` | blocker |
| L+D | filmstrip anatomy | text lane (titles), clip stills with name chips, music lane "♫ Hype instrumental · 120 BPM", playhead chip | one flat tinted bar: clips have no `ClipPic`/name, no title lane | `sections/video.jsx:41-100`, `video.css:86-98` | blocker |
| L+D | footage / Quality 480×270 / "Export" vs "Export 2 videos" | — | *(fixture)* | — | — |
| L+D | primary shows a heavy focus ring on open | no ring | 2px ring | `export-sheet.jsx:205` (initialRef + :focus-visible) | warning |
| L+D | File names / Save to, R1–R5 | | | R7 | blocker |

**ex-inspector** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | export button | full width, centred, download icon, "Export 2 files" | auto width, left-aligned, no icon | `export.css:445-448`, `inspector-export.jsx:290-298` | blocker |
| L+D | preset row grid | `1fr 1fr auto` styled selects + `icon-btn` − | native mini selects + faint dash | R9 · `export.css:439-444`, `inspector-export.jsx:79-115` | blocker |
| L+D | kbd chips on Copy as PNG / Export… | `Kbd` chip | plain text | `export.css:479-484` | warning |
| L+D | inspector chrome: floating 280px island vs docked full-height panel with tabs | island | docked | inspector shell (06/14 owner) | warning |
| L+D | 2 presets / toast | — | *(fixture: one preset, copy not run)* | — | — |

**ex-formats** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | row anatomy | one line: leading ✓ icon col, label, reason right-aligned xs fg-2 (`k-mi-note`) | reason wraps to a 2nd line (`flex-basis:100%`), ✓ trails the label | `export.css:274-289` | blocker |
| L+D | group heads + separators | `k-mgroup` semibold, `k-msep` between groups | regular, no separators | `export.css:248-252` | warning |
| L+D | menu material | radius-lg, shadow-lg + island-edge, ~380 wide | radius-md, shadow-md, 340 | `export.css:224-240` | warning |
| L+D | search field focus ring + menu runs past the window bottom | — | 2px ring, clipped | `export.css:241-247` (max-height 340, no flip) | warning |

**ex-canvas** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | kind group row | 32px icon tile (bg-2) · semibold "Fixed size · 19" · names line (ellipsis) · thumb stack (28×34, −8 overlap) · styled select · note under | no icon, no names (shows "On this Mac"), no thumbs, native select | `sections/batch.jsx:28-50`, `advanced/advanced.css:8-40`, R9 | blocker |
| L+D | Folders + Save to rows | drawn | absent; extra "Other format" + Annotations rows that the board doesn't draw | R7 · `sections/batch.jsx` | blocker |
| L+D | counts/names | — | *(fixture)* | — | — |
| L+D | R1–R5 | | | | blocker |

**ex-batch-pick** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | ⌘A selection isn't carried into the sheet: Scope lands on This canvas "nothing was selected" | Selection 5 on, "Export 5 artboards", sub "Combine-kampan · 2026/combine" | canvas scope | `app.jsx:3225` (`exportSelectionV2(selected…)` gets no multi-select) | blocker |
| L+D | File names row (Canvas — artboard select + preview) / Save to | drawn | absent | R7 | blocker |
| L+D | group rows | as ex-canvas | as ex-canvas | `sections/batch.jsx` | blocker |

**ex-batch** (L, D) — folder scope was reached in the frame ("Export “ui” — 19 artboards").
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | title counts canvases | `Export "social" — 31 canvases` | "— 19 artboards" | `export-copy.js:51-54` | warning |
| L+D | group sub | "from 22 canvases — matchday, …", "In the cloud" note | "On this Mac" | `sections/batch.jsx:30-39` | blocker |
| L+D | shared-parts hint (eye-off) | drawn | a "big export" hint instead; shared-parts hint not shown *(fixture: no `_` folders)* | `sections/batch.jsx:93-108` | warning |
| L+D | Folders "One per canvas" + path preview, Save to "Downloads › social" | drawn | absent | R7 | blocker |

**ex-history** (L, D) — empty only *(no jobs in the browser lane)*.
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | top-bar Exports icon button (on state) next to the panel toggle | drawn | hidden while there are no jobs | `v2/shell/share-cluster.jsx:164-178` (`ex.show`) | warning |
| L+D | panel header icons | export icon + **folder** icon-btn + chevron | no folder button | `exports-panel.jsx:50-62` | warning |
| L+D | job rows / context menu (again, open folder, retry) | drawn | not observable — needs finished/failed jobs in the harness | — | blocker (unverified state) |

**ex-share-vs** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Export sheet share hint ("Tereza and Jonas are in this project… Copy link") | drawn | not reached (no people) | `share-hint.jsx` | blocker (unverified) |
| L+D | local-project card | island: "P" tile + semibold title, body, one primary "Move to cloud…" | a question title, Cancel + "Move to cloud" plus an "Only need a file?" line | `v2/share/move-to-cloud.jsx` (owned by 10) | warning |

**ex-handoff** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | target rows | radio dot (14px, 4px accent inset when on) + target icon (browser / phone / play) + semibold title; off rows bg-3 fill | no radio, no icon; off rows white with a 1px inset line | `handoff/handoff-sheet.jsx:252-277`, `handoff.css:13-41` | blocker |
| L+D | whole-dialog 2px focus ring on open | none | heavy accent outline round the sheet | `handoff-sheet.jsx:88-95,229` (no focusable initialRef → root focused) | blocker |
| L+D | review hint | check-circle icon + "Last review: no blockers. …" in bg-3 hint | plain `<p>`, no icon | `handoff/edges.jsx:39` | warning |
| L+D | Advanced | chevron + inline hint, in the footer row | no chevron, hint right-aligned, its own row | `handoff-sheet.jsx:295-304`, R5 | warning |
| L+D | sub, "Use the design system", Last used chip, target names | — | *(fixture: no DS, no last handoff)* | — | — |
| D | on-target fill | accent-muted, fg-0 text | saturated v1 indigo fill, white text | R1 | blocker |

**ex-handoff-edges** (L, D) — only the signed-out path was reached.
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | not-connected | small single dialog: title "Connect your Claude account to let AI draft this." (type-md semibold), body, Cancel + "Connect ↵" | handoff sheet frame with a nested card "Connect your Claude account?" + "Claude Pro or Max" option + small Connect without ↵ (double frame) | `handoff/edges.jsx:47`, `v2/ai/ConnectSheet.jsx:39-67` | blocker |
| L+D | offline queued row in Exports; blockers warn hint with Show on canvas | drawn | not reached | — | blocker (unverified) |

**ex-offline** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | top-bar status "Offline — kept on this Mac" | drawn | absent (browser offline doesn't trip the app's offline state) | `export/cloud-queue.js` `useOnline` / shell status | blocker |
| L+D | Render cards: cloud card off "Waits for a connection…", This Mac on | drawn | Render row absent | `sections/render-row.jsx:22` | blocker |
| L+D | rest | as ex-video | as ex-video | — | blocker |

**ex-huge** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | title / sub | "Export everything in Alligators brand" / "93 canvases in 5 folders, plus 4 at the top level" | "Export the whole project — 19 artboards" / "Matchday" | `export-copy.js:55,64-70` | blocker |
| L+D | Include row (folder checks) | drawn | absent | `sections/batch.jsx` | blocker |
| L+D | ZIP hint | folder icon + accent-text "Project ZIP instead" link | archive icon; link reads near-black (v1 accent-text 0.40/268) | `sections/batch.jsx:110-115`, R1 | warning |
| L+D | Print counted in pages ("46 pages") | pages | artboards | `sections/batch-model.js groupTitle` | warning |
| L+D | group rows | as ex-canvas | | | blocker |

**ex-print-warn** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | in-sheet preflight | Print checks in a row (`ex-checks--row`); warn hints (status-warn 14% mix, `problem` icon, "Show on canvas") for the safe margin and the font; paper with the QR flag "2 mm to the cut" + dashed safe margin | nothing: preflight pending, so the 1px finding shows only in the inspector | `sections/print.jsx`, `preflight/use-preflight.js` | blocker |

**ex-advanced** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | fields | styled selects; Exact scale field "2.5×"; Codec select; Bitrate "High"; Frame rate "30 fps — as made"; GIF colours; Long videos; Paper row; JPG quality | native selects; × sits outside the field; Codec plain text; "Automatic"; "As made"; GIF colours / Long videos / Paper absent | R9 · `advanced/image.jsx`, `advanced/print.jsx`, `advanced/video.jsx` | blocker |
| L+D | render Status | "● Ready" (success dot) | "This Mac renders — no service needed" *(lane fixture)* | `advanced/render.jsx:23` | — |
| L+D | panel material | per-kind island cards (island-bg-strong) | flat 2-col grid inside the sheet; sheet runs past the window bottom | `advanced/advanced.css` | warning |
| L+D | File names card (mono pattern + token chips + preview) and terminal commands card | drawn | below the fold, not observed | — | warning |

**Unreachable (spec-only), so these states don't exist in the harness yet:**
- **ex-progress** needs a running export job: a cloud render or a this-Mac render feeding the Exports-icon ring (`share-cluster.jsx` `Ring`) in the browser lane. That means a job-runner stub or a seeded `_api/export-jobs`.
- **ex-states** needs Cloud / this-Mac / done / partly-done job rows, i.e. seeded finished and failed jobs.
- **ex-handoff-ready** needs a finished AI handoff run (a signed-in claude stub that returns a Ready card).
- **ex-edges** needs a viewer-role session (Can view → no sheet, `access-line.jsx`) plus a live AI run on the target (`AiHint`/`VersionRow`, `sections/version.jsx`).

_Counting: one row = one finding (an L+D row counts once); the 4 unreachable artboards count as blockers; (fixture) rows are not counted._

_Counting: one row = one finding (an L+D row counts once); the 4 unreachable artboards count as blockers; (fixture) rows are not counted._

```json
{"canvas":"09 Export","critic":"design-critic","blockers":52,"warnings":22,"verified_ids":[]}
```
