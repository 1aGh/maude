# Tours (usage, collab, quick-setup), SetupChecklist, "Start quick setup", What's new panel/toast, ReportBugDialog (3 steps), Help modal sections — home `G0-D/D13` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D13.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D13` · action `help.tour` · testid `-`
- where: Menu › Help › Take the tour · Set up Maude… (the checklist) · What’s new · Report a bug… · Help and guides (F1); a first-run line on Home
- v1 entry points mapped to this row: 39
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: menu (menu row) · browser: ok: menu (menu row) · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/v2-callouts.test.tsx` — "the stack never offers a tour; the tours live at Menu › Help › Take the tour"
- `apps/studio/test/whats-new-replay.test.tsx` — "a replayable entry offers Take tour; a non-replayable one does not" · the committed feed carries the v2.0 entry
- `apps/studio/test/v2-recovery-host.test.tsx` — "after an unclean exit: … Report a bug… opens the dialog from the crash"
- `apps/studio/test/v2-s11-13-advanced.test.tsx` — "Report a bug reads the policy: ask offers the logs unticked, always ticked, never not at all"
- `apps/studio/test/p8-b1-copy.test.ts` — SetupChecklist copy ("Ask AI to build each step")
