# Persisted prefs (~40 `mdcc-*`/`maude-*` keys, `prefs.json` panelSides/layersMode) — home `G0-D/D20` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D20.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D20` · action `-` · testid `settings-sheet`
- where: Not a control: client/prefs-migrate.js runs once at boot and re-keys the v1 prefs (theme, panel positions, fold state, “seen” flags); the migrated values show in Settings › General and Layout
- v1 entry points mapped to this row: 0 (prefs are not controls — the migration tests below are the proof)
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: settings-general · browser: ok: settings-general · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-s11-13-prefs-migrate.test.ts` — the v1 prefs re-keyed once at boot
- `apps/studio/test/prefs-migrate.test.ts` — the migration table (theme, panel positions, fold state, seen flags)
- `apps/studio/test/v2-settings.test.tsx` — settings sheet persistence
