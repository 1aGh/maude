# Right-click menus: world (Fit/Reset view, Paste artboard, Export project ZIP / canvas as separate), artboard (Theme, Kind, Fit, Reset position, Convert to absolute, Open Timeline), element (Inspect, S — home `G0-D/D6` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D6.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D6` · action `-` · testid `.dc-context-menu / [data-action]`
- where: Right-click in the canvas — the element menu on an element, the artboard menu on an artboard’s label, the world menu on empty canvas; ⌘K lists the same rows (until the v2 object menus, S2)
- v1 entry points mapped to this row: 60
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: menu · browser: ok: menu · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-inspector-advanced.test.tsx` — "Copy style and Paste style run the registry actions the canvas already has" (object menu Advanced)
- `apps/studio/test/edit-object-client.test.tsx` — describe "runObjectOp": the object-menu ops run through the registry op with targets and params
- `apps/studio/test/v2-artboard-theme.test.tsx` — "DS default pins; the pin reads back on the frame; Follow chrome frees it" (artboard Theme)
- `apps/studio/test/v2-artboard-menu.test.tsx` — the artboard menu: Duplicate at another width lands under the source
