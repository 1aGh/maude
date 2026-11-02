# Inspector Advanced raw CSS (~33 properties, custom CSS property rows, HTML attribute rows) and the Designer/Advanced vocabulary toggle — home `G0-D/D18` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D18.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D18` · action `-` · testid `inspector-section-advanced`
- where: Select an element → Inspector › Advanced (the fold at the foot) keeps the full raw editor unchanged (about 33 properties, custom CSS rows, HTML attribute rows); Designer is the only default (S2.2)
- v1 entry points mapped to this row: 40
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: inspector-advanced · browser: ok: inspector-advanced · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-inspector-render.test.tsx` — the inspector Advanced fold (inspector-section-advanced)
- `apps/studio/test/v2-inspector-advanced.test.tsx` — the raw editor unchanged: custom CSS property rows, HTML attribute rows
