# Browse tool — home `G0-D/D1` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D1.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D1` · action `tool.browse` · testid `toolbar-slot-browse`
- where: Preview toolbar › Hand (H) — a click uses the design, a drag pans; “?” › Keys and tools that moved
- v1 entry points mapped to this row: 1
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: preview · browser: ok: preview · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/tool-palette.test.tsx` — "Preview: Hand · Sticky N …" and "Viewing: Hand → inspect · Comment" — Hand is the browse tool (a click uses the design, a drag pans)
- `apps/studio/test/v2-menubar-retired.test.ts` — "the manifest has the entries (frozen) and each one is mapped" · "a row target has a v2 home: an action or a hook, and the path a person follows"
