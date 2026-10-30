# CloudBar project list (Connect/Disconnect), "Connect this folder" deep link, file deep-link dialog, device-code sign-in — home `G0-D/D11` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D11.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D11` · action `-` · testid `settings-cloud-projects`
- where: Settings › Connections › Maude Cloud › Cloud projects on this Mac (Connect · Disconnect · View in the browser; cloud-project-<id>, cloud-disconnect-<id>); the maude:// deep-link dialogs and the browser sign-in sheet stay where they open from (cloud-deeplink-*, cloud-device-dialog)
- v1 entry points mapped to this row: 31
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: settings-cloud-in · browser: ok: settings-cloud-in · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-s11-14-connections.test.tsx` — Settings › Connections: Maude Cloud, cloud projects on this Mac (Connect / Disconnect)
- `apps/studio/test/v2-settings.test.tsx` — the Settings sheet and its Connections section
