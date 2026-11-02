# Contextual element toolbar (copy selector/id, inspect, align, Tidy up) — home `G0-D/D7` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D7.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D7` · action `-` · testid `edit-align-bar`
- where: Select two or more objects — the align bar floats above them (align, distribute; S2.7). Copy CSS, Copy ID, Inspect and Add comment are in the object menu, Advanced ▸; Tidy up is the artboard bar's (S2.9)
- v1 entry points mapped to this row: 8
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: selection-multi · browser: ok: selection-multi · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/edit-multi-client.test.tsx` — "every arrange action and object.rotate is a canvas action for Can edit" · "only objects placed freely can be aligned" (the align bar)
- `apps/studio/test/v2-inspector-advanced.test.tsx` — line 165: element.selector (copy selector) lives in the object Advanced
