# ⇧⌘R Refresh tree, T toggle tree, H hidden files, S DS view, N new board — home `G0-D/D4` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D4.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D4` · action `canvases.refresh` · testid `canvases-refresh`
- where: Menu-less: Canvases › Advanced › Refresh + ⌘K "Refresh tree" (⇧⌘R); hidden files = Canvases › Advanced switch; DS = pinned row; tree = ⌘\ / panel icon; new board = ⌘N
- v1 entry points mapped to this row: 3
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: left-canvases · browser: ok: left-canvases · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-left-panel-render.test.tsx` — the Canvases › Advanced fold: Refresh (canvases-refresh), Show hidden files
- `apps/studio/test/p8-c10-hidden-tree.test.ts` — hidden files: sidecars under their canvas, runtime at the root, arrow-key stops
