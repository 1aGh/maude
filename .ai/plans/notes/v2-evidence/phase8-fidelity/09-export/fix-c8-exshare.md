# 09 Export — round 8 (p8-c8-exshare): done / open

Checklist: the MUST rows of `critic-bar3.md` (ex-video, ex-offline, ex-batch, ex-advanced). Verification: fail-first tests (red on the feat tip, green after; the ex-advanced test also red with `image.jsx` put back), tsc + biome, release rebuild, `check-client-boots-source`, `opening-card-clears`, re-shoot with `_c8-harness-g3` on the Mac mini (`chain.sh 09` = `t09b vid adv`, light + dark).

## Done

| id | what | tests |
|---|---|---|
| ex-video, ex-offline | the footer's lane words follow the Render card that is ticked, not the lane the estimate was asked in (`export-sheet.jsx`, the `summaryWords` call: `{ ...est, lane: render.lane }` when the Render row is shown). Own commit, one line | `v2-export-video.test.tsx` (Suggest each time ticks the cloud → "in the cloud"; pick On this Mac → "on this Mac"; back) |
| ex-batch | **Folders › One per canvas** is real: spec option `options.folders: 'one' \| 'per-canvas'` (`spec-v2.ts` validates it; `canvasDir` in `file-names.ts` = the canvas path without `.tsx` / the design root's own `ui/`, every segment made safe); `collectGroup` names each file `<canvas path>/<name>` and judges a duplicate inside its folder; a one-file result downloads under its own name, never the path; a retry reads the held zip back with those names. The sheet's select offers the two, the path hint under it reads "<canvas path> · <first file>"; ignored on Selection scope (that scope has File names instead) | `p8-c8-exshare-folders.test.ts` (canvasDir, validation, zip entries, per-folder dedupe, single file), `v2-export-batch.test.tsx` (select, posted spec, default sends nothing) |
| ex-advanced | each part sits under its visible heading (Image — PNG · JPG · Print PDF · Video — MP4 · GIF · WebM · Where it renders, `export-adv-<part>-title`); JPG quality is always on the Image part; Bleed keeps its switch and has the board's mm field beside it (read-only: the page is trim + 2 × bleed, so an export cannot change the amount; it reads the artboard's bleed, 3 mm until the paper is known); Paper is the board's select with the one answer there is ("Same as artboard"); a select no longer outgrows its column (the Text select was clipped at the sheet's right edge) | `v2-export-batch.test.tsx` (headings, JPG row, Bleed field read-only, Paper select; red with `image.jsx` at the feat tip) |

## Open

- ex-advanced: Image title says "PNG · JPG", the board says "· SVG" — SVG has none of the image knobs, so the title stays honest.
- ex-advanced: Bleed amount and Paper are drawn but not editable (no export-time bleed or paper override exists; both are authored on the artboard). A board follow-up if they are meant to change per export.
- ex-offline: the footer line is the sheet's own words ("about 40 seconds on this Mac"), the board's offline line reads "starts now on this Mac, about 3 min" and counts videos ("2 videos") — copy not changed.
