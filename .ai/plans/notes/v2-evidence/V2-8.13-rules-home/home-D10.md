# Git panel: empty states, "Cloud is saving", result banners, Undo a restore, Retry cloud history, Save all, DiffView (compare, side by side / overlay wipe, zoom), chat-guard before branch switch — home `G0-D/D10` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D10.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D10` · action `history.open` · testid `vh-panel`
- where: Menu › Version history ⌥⌘H → the Version history panel (S1.14): “Versions appear here as you work.”, “Couldn’t load versions” + Retry versions, result banners as one-action toasts (“Restored 5 Oct, 18:40 · Undo”), Undo a restore; › Advanced keeps the full change list and Compare pictures (testid git-panel)
- v1 entry points mapped to this row: 40
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: history · browser: ok: history · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-git-advanced.test.tsx` — "an editor in the desktop app gets the whole fold" · "a cloud tab is \"Cloud versions\": the list and its retry" · "a failed cloud read is a Retry, not \"no versions\"" · "Compare pictures stays (it is S1.15's)"
- `apps/studio/test/git-cloud-posture.test.ts` — "Cloud is saving" posture
