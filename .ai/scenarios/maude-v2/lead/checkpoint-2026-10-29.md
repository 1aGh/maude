# Lead checkpoint — 2026-10-29 ~04:40 (plan A: builders + eval finished, then stop)

Weekly usage is at 80 % and resets Fri 2026-10-30 09:00. feat/maude-v2 is at 5601f2c70 (pushed); tsc and
check-client-boots-source are green on the merged tip. No builder is running. The only worktree is the main
checkout plus whatever other sessions hold.

## Done since the 10-28 checkpoint
- **p8-t-missing-a merged (478cc3b31).** Two product fixes, both fail-first: the all-trashed card's endless
  read/render loop (stable `shellFetch`), and Restore into a canvas with no artboard left (`emptyCanvasPlace`).
  - The `team-cell-missing` lane runs es-all-trashed (card + race invariant), ia-missing and ia-edges D;
    ds-make-filling sits in ds-review part 4.
  - The lead narrowed the card test to "card and button" (the builder's fallback). The click-through on a synced
    copy and the race divergence are in pr-followups for the rc soak.
  - **The narrowed lane has not been run yet.** It needs a fresh debug desktop build, which it gets with the 8.3
    records. Run `e2e:team-cell-missing` once alone first.
- **p8-browser-e2e-format merged (d1602ee99, 74426f6ba).**
  - Every browser e2e harness writes formatVersion 2 (`e2eProjectConfig` + `scripts/dev/v2-config.mjs`, static pin).
  - The annotation e2e follows the v2 posture.
  - Product fix, fail-first: a press inside an open text editor never starts the Hand pan (`pressStartsPan`).
  - 16 of 17 files are green ×2. annotations-ui is 39 pass + 1 todo on the merged tip.
  - The todo is a product bug: undo drops a collaborator's concurrent text edit. It needs a design call from
    Michal (pr-followups).
- **Eval final: 90/90, 22/30 pass^3** (`.ai/plans/notes/v2-evidence/V2-8.16-eval/VERDICT.md`). e4 and e5 fail for a
  product reason: the post-edit gate blocks a *pre-existing* `artboard-id-expression` (a mapped DCArtboard id) and
  forces the agent to unroll the map. The remaining fails are agent-caused.

## For Michal in the morning
1. Is the eval's product FAIL (e4/e5) fixed before the freeze? The candidate fix is that the gate blocks only on
   findings the edit introduced. It is one fail-first builder plus an eval rerun of e4/e5 ×3.
2. Is the undo-merge bug (annotations-ui R7) fixed before the PR or listed as a follow-up?
3. Then, after the reset: freeze → chain4 (8.1, 8.3 ×3, 8.18, 8.2) → re-attests → ledger closure + pr-soak → .app
   → PR.

## Update ~06:00: Michal's a + b2 done (weekly 81 %)
- **p8-gate-introduced merged (f2db67394, grader a299a00bd).** The post-edit and Stop gates block only on findings the
  edit introduced; pre-existing findings go to the agent as additionalContext. The eval was rerun for e4 and e5:
  3/3 each. e4's scope now includes its safe-zone check artboard. **The final eval is 24/30 pass^3, with no
  product-caused FAIL.**
- **p8-undo-collab-refuse merged (6e87df463).** On the local runtime, ⌘Z on a text a collaborator changed meanwhile
  gets 409 undo-conflict; the existing stale notice shows and their text stays. annotations-ui R7 is a real test
  again, and annotations-ui ran 40/40 twice. The hub-linked runtime does not refuse yet (pr-followups).
- Next, after the reset (Fri 09:00): run `e2e:team-cell-missing` once alone on a fresh debug build → freeze →
  chain4 → re-attests → ledger + pr-soak → .app → PR.

## Update ~07:35 — weekly 84 %, stopped until the reset
- **p8-hub-undo-collision (b82b82f6c).** In a hub-linked project, ⌘Z on a text is refused only when it would collide
  with a collaborator's change (studio-only, 1.x hubs unchanged). Run twice on a loopback hub, green both times.
- **Legacy undo: not fixed (Michal).** The mitigation is p8-update-to-accepted (75df7c36f). Update project now also
  switches a legacy project to accepted revisions: as the last step, on a re-read epoch. `--reverse` keeps the mode.
  A cloud tab points to the dashboard. The loopback legacy-hub run shows both studios picking up the switch live,
  with nothing lost.
- Every fix is merged and pushed. tsc and the boot check are green on da2e7b22c.
- **Next, after the reset:** `e2e:team-cell-missing` alone on a fresh debug build → freeze → chain4 → re-attests →
  ledger + pr-soak → .app → PR.
