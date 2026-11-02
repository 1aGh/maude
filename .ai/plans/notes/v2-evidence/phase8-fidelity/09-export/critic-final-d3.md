# 09 Export — FINAL critic re-check (stage D3, merged tip 63592219a)

One critic, four lenses. Pairs: full-size D3 set (`full-size-path.txt` last line). Light read for every id; dark read for ex-social, ex-print, ex-web, ex-inspector (the match candidates) and judged identical to light for the rest (theme-only difference; the failing content is the same in both).
Fixture differences (names, counts, pixel sizes 432 x 540 vs 1080 x 1350, footage) are not blockers. File-name pattern `<canvas> — <artboard>@<scale>` follows the board's own token card (ex-advanced), so it is not a blocker.

Fixed since D2: ex-social preview + px chips + quoted artboard title (light); ex-inspector now shows an artboard inspector with Export / Copy as PNG / Export… rows; ex-handoff light now draws the radio cards.

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ex-print | L, D | match | warning only: heavy focus ring on primary at open |
| ex-web | L, D | match | none |
| ex-social | L | match | none |
| ex-social | D | differs | preview tile is an empty dark placeholder (the photo never paints; light shows it); size chip 1x 436 x 544 vs 432 x 540 in light (inconsistent) |
| ex-formats | L, D | differs (cannot confirm) | Other… menu is cut at the window bottom after "Canva" (Web page (HTML), Code…, Project ZIP not visible); MP4 / GIF / WebM / Sound only are four plain rows without the "new" tag on JPG / Sound only; "Needs a video artboard" rows fine |
| ex-inspector | L, D | differs | no "Copied “…” as a PNG — paste it anywhere" toast; Preset row absent; one export row instead of 1x PNG + 2x JPG ("Export 1 file", fixture-ish); no kbd chips on Copy as PNG match spec only partially |
| ex-video | L, D | differs | filmstrip is an empty blue bar (no stills, names, title lane, music bed); no In the cloud / On this Mac render cards; Sound switch off |
| ex-offline | L, D | differs | as ex-video; no "Offline — kept on this Mac" top-bar status; no render cards |
| ex-canvas | L, D | differs | shot is a selection export of one Frame ("Kontakt…", Selection 1) with a blank preview, not the "Export <canvas> — N artboards" kind-rows sheet; no kind rows, no Folders path to the right |
| ex-batch-pick | L, D | differs | Selection 3 shows the single-kind form (Format / Size), not Fixed size / Print kind rows with stills; File names row is a plain field, no Canvas — artboard select |
| ex-batch | L, D | differs | four kind rows with icon tiles but no stills on any row; sub line shows internal folder name "ui"; Folders is "One folder" only (no "One per canvas", no Downloads › social); no "In the cloud" note on the video row; shared-parts hint missing |
| ex-huge | L, D | differs | no stills; Include row (folder checks) absent; ZIP hint link "Project ZIP instead" grey, not accent text; hint has no leading icon alignment of spec |
| ex-print-warn | L, D | differs | in-sheet preflight warnings (QR 2 mm from the cut, font not embeddable) and "2 mm to the cut" tag never show; Safe 5 mm legend missing; Add the back is a 3-line check here (spec compact) |
| ex-advanced | L, D | differs | per-kind cards are a two-column strip inside the scrolling sheet; Exact scale "1" (spec 2.5x); no JPG quality, Paper, Codec, Bitrate, Frame rate, GIF colours, Long videos, Render service; File names token card + terminal commands card absent; Bleed / Crop marks as switches with notes, spec mm field |
| ex-history | L, D | differs (cannot confirm) | only the empty "No exports yet" panel; rows, header folder button, context menu (Export again…), Retry Recap, top-bar Exports icon not shown |
| ex-share-vs | L, D | differs (cannot confirm) | Share opens the "Move to the cloud?" card; the Export hint (Copy link) and the Share-sheet comparison not reached |
| ex-handoff | L, D | differs | no "Last used" tag; 4th row "Design tokens — Needs a design system" is not on the board; no "Use the design system" checkbox + sub line; review hint plain text (no pill / check icon); sheet title has no sub line (Desktop, Tablet, Mobile · system) |
| ex-handoff-edges | L, D | differs | sheet shows only the title with an empty body (no "Connect your Claude account" card, no Connect/Cancel); offline queued row and blockers variant not reached |
| ex-progress | L, D | differs | rows lack thumbnail tile and named job ("Hype trailer · 2 videos · 4K"; shows "MP4 · Canvas"); progress text "On this Mac · Queued" not "about 1 min left"; no header folder button; no Ready row with pages |
| ex-states | L, D | differs | panel rows only (generic names); cloud / this-Mac cards and the three done / partly-done / no-sound toasts with Show in Finder / Retry Recap not shown; row copy truncated "Recap the m…" |
| ex-handoff-ready | L, D | unreachable | needs a finished AI handoff run: a signed-in claude / ACP stub returning the Ready card with its copy command |
| ex-edges | L, D | unreachable | needs a viewer-role session (Can comment) plus a live AI edit on the artboard: a role override and an AI-run stub in the harness |

```json
{"canvas":"09 Export","dir":"09-export","match":["ex-print","ex-web"],"match_one_theme":{"ex-social":"light"},"differs":["ex-formats","ex-inspector","ex-video","ex-offline","ex-canvas","ex-batch-pick","ex-batch","ex-huge","ex-print-warn","ex-advanced","ex-history","ex-share-vs","ex-handoff","ex-handoff-edges","ex-progress","ex-states"],"unreachable":["ex-handoff-ready","ex-edges"]}
```
