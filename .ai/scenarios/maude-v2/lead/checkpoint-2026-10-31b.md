# Lead checkpoint — 2026-10-31 evening: Michal's rc.1 round + UX audit

**State at feat `97a610d61` (pushed).**

All of Michal's 20 rc.1 findings are fixed and merged in packages A, B, C, D1, D2, E, ds-specimens and roleless-signin. The brief is `lead/brief-michal-rc1-findings.md`. Michal decided:
- 1C: drop the stale localhost link.
- A: a record without a role offers Sign in.
- 9A: every specimen becomes its own artboard.
- 17: Preview gets multiselect and marquee (shipped as Select V + Hand H).
- ⌘D: the copy lands at +10/+10.

All of these are in kg.

Merge gates on the tip are green: tsc, biome, boot, nothing-deleted 100 %, lint ratchet 99.

**Not yet verified at the tip:**
- The full studio suite. The last mini run was at 8ee4cc294: 21159 pass / 3 fail.
  - `dead-controls`: fixed since, in 4b61873cd and 93bc55884.
  - `the Canvases panel > the index churning does not become a request storm`: check.
  - `G5 — a whole-canvas chat groups under its canvas`: check.
  - A builder also saw `asset tiles ... two renderer lanes` once.
- A stale browser e2e, "M shows the tips, five inks with +4", expects `toolbar-ink-more`. Fix the test.
- Desktop e2e steps written but not run alone: edit-pen, clipboard-drop, modes-present, shell-panels (the home and shell-strip lanes ran green). Chain4 covers them.
- `input-router.tsx` and `canvas-lib.tsx` changed, so WebKit must be re-measured. Use the Mac mini with Michal's GUI-session `safaridriver -p 4488`; the probe adopts port 4488.
- Characterization goldens: `V1_KEYS_UPDATE=1` for `keys.txt` / `browser__shortcuts.txt` (the "?" fold is now closed), if they go red.

**UX audit:**
- Evidence: `.ai/plans/notes/v2-evidence/ux-audit-rc1/`, with 114 shots, the INDEX and 7 critic reports.
- `REDUCE.md` holds 69 findings: 2 blockers, 34 before-merge, 33 rc-patch, 10 taste decisions TD1–TD10, 6 verify-in-app, and packages P0–P6.
- **Running:**
  - builder `r2-text-tool`: blocker F01 text typing, plus the Inspector's stale X/Y;
  - builder `r2-comments`: P4;
  - debate seats builder / shipper / breaker / user-advocate, blind, on TD1–TD10.
- **Waiting on Michal (asked via the keeper):** yes/no on 6 verify-in-app checks in his .app (object right-click, pin click, DS canvas, AI entry, `?`, Back to Home), and the debate result. Ask whether P5 and part of P6 go to an rc patch, given the budget.

**Next:**
1. Synthesize the debate: one pick plus 1–2 alternatives per TD. Send it to the keeper.
2. On Michal's answers, spawn P1 (rest), P2, P3, P5, P6 per REDUCE.
3. Merge.
4. Run the full suite on the mini at the tip.
5. Freeze, pre-checks, chain4, the full-suite run on the mini, re-attests (WebKit on the mini), then the .app, PR.md and READY TO TRY (11).

Budget: weekly usage is 43 %.
