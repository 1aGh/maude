# 09 Export — round 4 (p8-c4-kindsexport): done / open

Same verification as `08-artboard-kinds/fix-c4-kindsexport.md`.

## Done

| what | tests |
|---|---|
| Batch kind rows follow the board: icon tile first, names + stills, value with its small note under it; Print counts pages; no Other format / Annotations rows (they live under Advanced > `BatchAdvancedRows`); Folders is a select with the path under it | `v2-export-batch.test.tsx` |
| Whole-project title uses the same project name as the pill (`app.jsx`: `cloud.projectName || cfg.name || project`) so it reads "Export everything in <project>" | existing `sheetTitle` pins |
| Print: title "+ its back", summary "1 PDF · 2 pages · …", page strip = 34 x 47 thumbnails with ‹ › | `v2-export-print.test.tsx` |
| The "Copied … as a PNG" and every other pill is one line | `p8-c4-toast-rule.test.tsx` |

## Open

- Video (ex-video, ex-offline): filmstrip clip stills / names / title lane / music bed (needs per-clip frames — `StripClip` carries no name or picture; names could come from `ClipSpan.src`, stills need a frame route), In the cloud / On this Mac render cards on the video sheet (the render row exists in the sheet's lane row, not the board's cards).
- ex-huge: the Include row (folder checks) needs a per-folder spec filter; the ZIP hint link still looks grey in the shot (CSS matches the board: accent text — check the `.btn--ghost` cascade).
- ex-print-warn: in-sheet preflight warnings need the headless safe-margin measure.
- ex-advanced: Paper, Codec, Bitrate, GIF colours, Long videos, File names card, terminal commands card, Exact scale "2.5x" field.
- ex-inspector (kbd chips, "Preset" word), ex-formats (frame crops the Other… menu), ex-history populated rows, ex-share-vs, ex-handoff-edges, ex-progress / ex-states copy: harness or other owners.

## Decisions

- `decision:maude/v2-p8-c4-batch-extras-under-advanced` — Other format and Annotations leave the batch sheet's main rows (the board draws neither) and sit at the top of Advanced's foot. Rejected: deleting them (Other… is the only way to a batch ZIP / PDF of everything), hiding behind a kebab (a new control).
