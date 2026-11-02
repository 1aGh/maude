# Files panel: New folder, inline composer, folder menu, drag-drop, keyboard tree nav, open-comment count, Figma/experimental badges, non-canvas file preview — home `G0-D/D5` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D5.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D5` · action `-` · testid `canvas-list`
- where: Canvases panel (tree kept: New folder, composer, folder menu, drag-drop, keyboard nav, comment counts, badges); preview via Canvases › Advanced › Hidden files
- v1 entry points mapped to this row: 29
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: shell · browser: ok: shell · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-left-panel-render.test.tsx` — the Canvases panel (tree, rows, menus)
- `apps/studio/test/p8-c10-hidden-tree.test.ts` — "a supporting row is one plain line and is a stop for the arrow keys" (keyboard tree nav, non-canvas file rows)
- `apps/studio/test/v2-canvases-rename.test.tsx` — "⋯ opens Open · Pin · Rename · Duplicate · Move to… · Copy link · Move to trash"
