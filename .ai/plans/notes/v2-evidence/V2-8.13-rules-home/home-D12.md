# TeamProjects "Your team's own server" form, SyncConsentDialog, Sync notice Dismiss, delivery attention list, SyncBanner diverged/rejected, CloudRoleBanner, mode-hint toast — home `G0-D/D12` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D12.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D12` · action `-` · testid `settings-team-server-add`
- where: Settings › Connections › Your team’s own server › Add a team server… (the address / email / password form, team-hub-*); first-link consent stays in its flow, its rule is Settings › Advanced › This project › When a folder first links (sync-setting-firstAnchor); Sync notice Dismiss, delivery list and the status words are V2-4.7b / status-word packages — V2-4.8b: the sync notice (diverged / rejected / long offline) is a callout (callout-sync-diverged · callout-sync-rejected · callout-sync-offline-long, one action Details → Diagnostics › Sync; the reconnect flash is callout-sync-back; a short offline spell is the Share cluster word “Offline — kept on this Mac”); the role notice is callout-role (once per role) + the always-visible access word (Can view / Can comment)
- v1 entry points mapped to this row: 15
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: settings-connections · browser: ok: settings-connections · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-s11-14-connections.test.tsx` — Settings › Connections: "Your team's own server" add form (settings-team-server-add)
- `apps/studio/test/v2-callouts.test.tsx` — "diverged: what happened, what is safe, one action" · "rejected documents use the noun for 1 and for many" · "update, repo changed and role carry the v1 strip's words and its one action" (SyncBanner / CloudRoleBanner replaced)
- `apps/studio/test/v2-settings.test.tsx` — the Settings sheet (Connections, Advanced)
