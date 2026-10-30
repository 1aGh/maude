# Native OS menu: About, Check for Updates…, Quit, Help › Report a Bug — home `G0-D/D19` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D19.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D19` · action `-` · testid `settings-check-updates`
- where: Native menu unchanged (CONTRACT §1: About, Check for Updates…, Quit, Help › Report a Bug); Settings › Advanced › This Mac › Update › Check for updates runs the menu's own check (desktop app only, Tauri `check_for_updates`) beside the staged build's Restart now · Later
- v1 entry points mapped to this row: 6
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: settings-advanced · browser: n/a · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-settings.test.tsx` — Settings › Advanced › Check for updates (settings-check-updates)
- `apps/desktop/src-tauri/src/menu.rs` — native menu: About, Check for Updates…, Quit, Help › Report a Bug (Rust; rust tests via cargo, not re-run here)
