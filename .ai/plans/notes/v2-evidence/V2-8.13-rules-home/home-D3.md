# Canvas-palette Export ⌘E, ⌘⇧E re-run last export, in-canvas export dialog — home `G0-D/D3` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D3.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D3` · action `export.open` · testid `export-submit`
- where: Menu › File › Export… ⇧⌘E (the one sheet; “Export again” on every Recent row, export-recent); ⌘E is unbound
- v1 entry points mapped to this row: 9
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: export · browser: ok: export · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-export-sheet.test.tsx` — "⇧⌘E with nothing selected opens This canvas" (the one sheet)
- `apps/studio/test/exports-panel.test.tsx` — "Export again is on every finished row, and only on those"
- `apps/studio/test/export-one-sheet.test.tsx` — one sheet for every export entry point
