# Palette "Toggle theme", "New video…" — home `G0-D/D17` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D17.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D17` · action `settings.theme` · testid `settings-theme`
- where: Settings › General › Look › Theme (settings-theme) and ⌘K “Theme” (settings.theme); ⌘K “New video” + New artboard › Video are V2-5 / 08
- v1 entry points mapped to this row: 1
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: settings-general · browser: ok: settings-general · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-settings.test.tsx` — Settings › General › Look › Theme
- `apps/studio/test/v2-gate-polish2.test.tsx` — "the Look group is one Theme row with three radios" · "a picked theme (the View toggle, ⌘K Theme) ends Auto"
- `apps/studio/test/v2-gate-focus.test.tsx` — the settings.theme action
