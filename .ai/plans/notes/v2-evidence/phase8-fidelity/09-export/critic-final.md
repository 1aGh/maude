# 09 Export — FINAL critic re-check (stage D2, merged tip d3881fe41)

One critic, four lenses. Pairs: full-size D2 set (`full-size-path.txt` last line). Light and dark were read for every id; dark differs from light only by theme, so verdicts are identical across themes. Spec dark is a host re-theme (INDEX), judged against the app's own dark tokens. Fixture differences (names, counts, footage, no DS) are not blockers.

Since stage D, verified fixed: print sheet title "+ its back", page strip as 34x47 thumbs with arrows, "1 PDF · 2 pages" summary; whole-project title "Export everything in <project>"; batch kind rows with icon tile, names, value + note, Folders select; Other format / Annotations moved under Advanced; ex-batch-pick carries the selection (Selection 6).

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ex-print | L, D | match | warnings only: primary Export carries a heavy focus ring on open; summary "about 61 KB" (fixture) |
| ex-web | L, D | match | none (Area seg, dashed first-screen preview, code line + link + kbd, File name / Save to) |
| ex-social | L, D | differs | preview tile is an empty white/blank placeholder; size chips read "1x 0 x 0" / "2x 0 x 0" instead of 1080 x 1350 / 2160 x 2700; title is "Export 1 artboard", not the quoted artboard name; File name "Matchday — Fixed size 1@1x" (spec: artboard name .png). Regression vs stage D (the preview + px were fixed there). |
| ex-formats | L, D | differs (cannot confirm) | same blank preview + "1x 0 x 0" behind the menu; the Other… menu overflows the window bottom and is cut after "Canva", so "Web page (HTML)", "Code…", "Whole project / Project ZIP" are not visible; the "new" tags on JPG / Sound only are absent; MP4 · GIF · WebM are three rows, board has one |
| ex-inspector | L, D | differs | the impl shows the Photo inspector (an image inside an artboard), not an artboard inspector: no Export row, no Copy as PNG / Export… rows, no "Copied … as a PNG" toast |
| ex-video | L, D | differs | filmstrip is an empty blue bar (no clip stills, names, title lane, music bed); "In the cloud / On this Mac" render cards absent; Sound switch off with "No sound on this timeline" (fixture); primary shows a heavy double focus ring |
| ex-offline | L, D | differs | as ex-video, plus no "Offline — kept on this Mac" top-bar status and no render cards |
| ex-canvas | L, D | differs | kind rows have no artboard stills (spec: thumbnail stack right of the row); Folders path preview sits under the select, spec puts it to its right |
| ex-batch-pick | L, D | differs | no stills on any row; File names row (Canvas — artboard select + preview) absent (impl shows Folders); selection 6 not 5 (fixture) |
| ex-batch | L, D | differs | stills only on Fixed size and Print rows (Web, Video rows empty); sub line shows internal folder name "ui"; Folders is "One folder" only (no "One per canvas", no "Downloads › social" path); no "In the cloud" note on video row; shared-parts hint replaced by big-export hint (fixture) |
| ex-huge | L, D | differs | no stills on any kind row; Include row (folder checks) absent; ZIP hint link "Project ZIP instead" is grey mono, not accent text |
| ex-print-warn | L, D | differs | in-sheet preflight warnings (safe margin "2 mm to the cut" + non-embeddable font) never show; finding only in the inspector card; Safe 5 mm legend missing |
| ex-advanced | L, D | differs | per-kind cards are one two-column strip inside the scrolling sheet; Exact scale "1" (spec 2.5x), no JPG quality, Paper, Codec, Bitrate, Frame rate, GIF colours, Long videos, render service; File names token card + terminal commands card absent; Bleed is a switch, spec a mm field; clipped at window bottom |
| ex-history | L, D | differs (cannot confirm) | only the empty "No exports yet" panel shot; rows, context menu (Export again…), Retry Recap, header folder button, top-bar Exports icon not shown |
| ex-share-vs | L, D | differs (cannot confirm) | Share opens the "Move to the cloud?" card; the Export hint "Tereza and Jonas are in this project… Copy link" and the Share-sheet comparison were never reached |
| ex-handoff | L, D | differs | light shot: sheet is title + Cancel + disabled Hand off with an empty body (targets never settled). Dark: radio cards drawn, but 4th row "Design tokens — Needs a design system" (server targets.ts) the board does not draw; no "Last used" tag; "Use the design system" checkbox + sub line absent; review hint is plain text, no pill/check icon |
| ex-handoff-edges | L, D | differs | sheet shows only the title with an empty body (no "Connect your Claude account" card, no Connect/Cancel); offline queued row and review-blockers variants not reached |
| ex-progress | L, D | differs | rows lack thumbnail tile and the named job ("MP4 · Canvas" for "Hype trailer · 2 videos · 4K"); no "about 1 min left"; no header folder button; no Ready row with pages; the cluster ring is present |
| ex-states | L, D | differs | panel rows only; cloud / this-Mac cards, the three done / partly-done / no-sound toasts with Show in Finder / Retry Recap not shown; row copy truncated ("Exported 114 of 115 — Recap the m…") |
| ex-handoff-ready | L, D | unreachable | needs a finished AI handoff run: a signed-in claude / ACP stub that returns the Ready card with its copy command |
| ex-edges | L, D | unreachable | needs a viewer-role session (Can comment) plus a live AI edit on the artboard: a role override and an AI-run stub in the harness |

```json
{"canvas":"09 Export","dir":"09-export","match":["ex-print","ex-web"],"match_one_theme":{},"differs":["ex-social","ex-formats","ex-inspector","ex-video","ex-offline","ex-canvas","ex-batch-pick","ex-batch","ex-huge","ex-print-warn","ex-advanced","ex-history","ex-share-vs","ex-handoff","ex-handoff-edges","ex-progress","ex-states"],"unreachable":["ex-handoff-ready","ex-edges"]}
```
