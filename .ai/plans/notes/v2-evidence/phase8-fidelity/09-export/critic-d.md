# 09 Export — stage D critic re-check (single critic, all four lenses)

Pairs: `<id>-<theme>.jpg` here; full size at `full-size-path.txt` (stage D). Spec dark = host re-theme of a light-pinned board (INDEX), so dark is judged against the app's own dark tokens; verdict is the same in both themes for every id unless noted. Fixture differences (names, counts, no footage, local project, no DS) are not blockers.

Fixed since stage B and verified in the shots: title names the artboard, preview column, px on size chips, File name / Save to rows, pressed-segment ring, footer anatomy, kit dialog material, azure accent, checkbox off edge `--control-off`, handoff radio cards + keyboard arrows + no dialog ring, selection carried by ⌘A (ex-batch-pick now "Selection 6").

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ex-social | L, D | match | summary "a few seconds on this Mac" vs "a second", sheet ~20 px wider than 660: warnings only |
| ex-web | L, D | match | Area seg, dashed first-screen preview, code line with icon + link + kbd, File name / Save to all drawn |
| ex-handoff | L, D | match | warnings left open: extra "Design tokens — Needs a design system" 4th row (server `handoff/targets.ts`); review hint is plain text, no pill/icon; Lottie not off for a still frame; no sub line / DS checkbox (fixture) |
| ex-print | L, D | differs | copy: title lacks "+ its back"; summary "1 file · about 62 KB" vs "1 PDF · 2 pages · about 3 MB"; design: page strip is numbered chips "1 2" not 34×47 page thumbs, no ‹ › arrows; no stacked back page behind the preview (`sections/print.jsx`) |
| ex-video | L, D | differs | design: filmstrip is an empty blue bar (no clip stills, names, title lane, music bed); Render row (In the cloud / On this Mac radio cards) absent; format tile has no shape pic; primary shows a heavy double focus ring. Open per fix-export (needs clip pictures + cloud-capable estimate) |
| ex-inspector | L, D | differs | design: no "Copied … as a PNG" toast shown; ⇧⌘C / ⇧⌘E are plain text not Kbd chips; size select named "Size · Custom" where board 09 says "Preset" (08/14 own this, so copy follows 14); chrome docked card vs spec island (14 owns) |
| ex-formats | L, D | differs (cannot confirm) | the impl frame crops the Other… menu at the right and bottom, so the reason column, "For other tools" / "Whole project" groups, semibold heads and separators are not visible |
| ex-canvas | L, D | differs | design: kind rows have no icon tile and the still stack sits at the left, not the right; extra "Other format" and "Annotations" rows the board does not draw; Folders is plain text not a select with path preview; note line under select missing |
| ex-batch-pick | L, D | differs | same kind-row anatomy and extra rows as ex-canvas; File names row (Canvas — artboard select + preview) absent; rows show 6 not the 5 picked (fixture) |
| ex-batch | L, D | differs | sub line shows internal folder name "ui" under "Export “this folder” — 13 canvases"; no "One per canvas" Folders / "Downloads › social" path; no shared-parts hint (fixture); kind icon tile, extra rows |
| ex-huge | L, D | differs | copy: title "Export the whole project — 19 artboards" / "13 canvases in 1 folder" instead of "Export everything in <project>"; Include row (folder checks) absent; ZIP hint link is a mono grey button not accent text; Print counted in artboards not pages; kind rows as ex-canvas |
| ex-print-warn | L, D | differs | a11y/design: the in-sheet preflight warnings (safe margin "2 mm to the cut", non-embeddable font) never show; the 1 px finding appears only in the inspector. Needs the headless safe-margin measure in the lane |
| ex-advanced | L, D | differs | per-kind cards are collapsed into a two-column strip inside the scrolling sheet; Exact scale "1" (spec "2.5×"), no JPG quality, Paper, Codec, Bitrate, GIF colours, Long videos, Frame rate "30 fps — as made"; File names token card and terminal commands card not in the frame; Bleed is a switch not a mm field |
| ex-history | L, D | differs (cannot confirm) | only the empty state was shot; the rows, context menu (Export again, Show in Finder…), Retry Recap and the header folder button were not captured though the seeded-jobs route now exists (ex-states shows rows) |
| ex-share-vs | L, D | differs (cannot confirm) | Share opened the Move-to-cloud card (local fixture); the Export hint "Tereza and Jonas are in this project… Copy link" and the Share sheet comparison were never reached |
| ex-handoff-edges | L, D | differs | sheet shows only the title card with an empty body (no connect card, no Connect/Cancel); offline queued row and review-blockers variants not reached |
| ex-offline | L, D | differs | no "Offline — kept on this Mac" top-bar status; Render cards (cloud waits / this Mac on) absent; filmstrip empty as ex-video |
| ex-progress | L, D | differs | seeded Exports panel is shown, but rows lack the thumbnail tile and the named job ("MP4 · Canvas" for "Hype trailer · 2 videos · 4K"), progress copy lacks "about 1 min left", no header folder button, no "Ready" row with Print PDF pages |
| ex-states | L, D | differs | the board shows cloud / this-Mac cards, the Share-cluster ring and three done / partly-done / no-sound toasts with Show in Finder / Retry Recap; impl shows only panel rows. Toasts and the in-cloud vs this-Mac captions not captured |
| ex-handoff-ready | L, D | unreachable | needs a finished AI handoff run; a scripted ACP / signed-in claude stub returning the Ready card with its copy command |
| ex-edges | L, D | unreachable | needs a viewer-role session (Can comment, refused Can view per CONTRACT §7) plus a live AI edit on the artboard; a role override and an AI-run stub in the harness |

```json
{"canvas":"09 Export","dir":"09-export","match":["ex-social","ex-web","ex-handoff"],"match_one_theme":{},"differs":["ex-print","ex-video","ex-inspector","ex-formats","ex-canvas","ex-batch-pick","ex-batch","ex-huge","ex-print-warn","ex-advanced","ex-history","ex-share-vs","ex-handoff-edges","ex-offline","ex-progress","ex-states"],"unreachable":["ex-handoff-ready","ex-edges"]}
```
