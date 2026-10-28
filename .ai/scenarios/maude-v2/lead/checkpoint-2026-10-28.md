# Lead checkpoint — 2026-10-28 evening (before an auto-compact)

feat/maude-v2 HEAD at writing: `6de69e90d` (pushed). The run ends when `bash scripts/v2-done.sh` exits 0.

## Order (Michal via the keeper, fixed)

1. **Fix tests** — every round-B fix tested green on its branch and merged.
2. **The 54 remaining eval trials** (V2-8.16, pass^3), because Michal chose "B" so the eval lands BEFORE the
   final records. Resume command:
   `cd /Users/iagh/git/personal/maude; O="$TMPDIR/maude-agent-evals/v2-8.16"; NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 bun apps/studio/test/agent-evals/run.mjs suite --tasks all --topology A --trials 3 --skip-done --out "$O" >> "$O/suite.log" 2>&1`
   36 of 90 done. Then `bun apps/studio/test/agent-evals/run.mjs report --out "$O"`, then copy the report under
   `.ai/plans/notes/v2-evidence/`. Before resuming, send the keeper the weekly % and an ETA. Above 87 %, Michal
   decides. Weekly reset is Thu 2026-10-30 09:00. At 87 %: finish what is open and checkpoint; at 90 %: pause.
3. **Freeze** — no product commit from here on. Tell the keeper first so they can check nothing on the Mac
   interferes.
4. **Final records**, in this order:
   - `V2-8.1`: `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 node scripts/v2-gates.mjs --record V2-8.1`.
   - `V2-8.3` ×3 with the screen probe: `bash .ai/scenarios/maude-v2/lead/tools/record.sh`. Copy it to the
     scratchpad first and fix the `S`/`OUT` paths at its top. It holds on a `go` file and records with the probe +
     caffeinate. Recompile the probe with `swiftc -O probe.swift -o probe`. It matches the Maude window by PID and
     by height > 200; the window runs at layer 5 because of keep-front.
   - `V2-8.18` (Docker gate, `scripts/v2-verify/docker-selfhost.mjs`, under the lane, about 16 min).
   - `V2-8.2` (Rust).
   - `.ai/scenarios/maude-v2/lead/tools/chain3.sh` chains 8.1 → quiet-wait → record.sh → 8.2. Add 8.18.
5. After the records: re-attest the attest gates at the final HEAD:
   - 8.4 `.ai/scenarios/maude-v2/V2-8.4-final/report.md`
   - 8.8 `.ai/plans/notes/v2-evidence/V2-8.8-perf.md`
   - 8.9 the final-* reports + `V2-8.9-roundB-{defender,attacker}.md` + a recheck of the sec-lows fixes
   - 8.15 `V2-8.15-docs.md`
   - 8.16 eval report + journeys summary + `V2-8.16-real-push/` + `V2-8.16-real-pr/`
   - 8.5 aggregate
   Then build the .app (`check-bundle-completeness --smoke`, `check-client-boots`), mark the ledger rows, write
   PR.md (+ `lead/pr-followups.md`), run `v2-done.sh`, READY TO TRY, and open the PR into main (Michal merges).

## Running now (background agents and branches)

| What | Branch / task | State |
| --- | --- | --- |
| 2A format gate, verify + the cell raises its format at once | `p8-format-gate-2` (on `p8-format-gate`) | studio suite in halves, hub suite, desktop lanes, format-update e2e, Docker legs |
| Round-B security lows | `p8-sec-lows` | MERGED 8f238f19a |
| Live agent journeys | `$TMPDIR/maude-agent-journeys/2026-10-28-all/` | S2–S6, S9–S11 green both lanes; S1, S7 acp, S8 terminal red → p8-journey-fixes |
| Eval V2-8.16 | paused at 36/90 | resume after the fix tests (step 2) |
| Journey fixes S7 acp (AI cut not attributed), S8 terminal (no import-asset), S1 re-check | `p8-journey-fixes` | diagnose + fix fail-first, re-run S1/S7/S8 both lanes |

Merged today into feat: share/role ×4, sync ×3, multiplayer ×3, AI ×2, video ×3, shell, docker gate V2-8.18, the
real push and the real PR, AI parity trash, the server-up fixes (own session, retried probe), and the eval/journey
port base. Round-B follow-ups that won't be fixed are in `lead/pr-followups.md`.

## Michal's decisions today (all in kg)

- **V2-8.5 = B and more:** real tests for the 84 unreachable artboards. What can't be driven locally goes to the
  rc soak with a reason. `lead/e2e-round-brief.md`
- **Order:** everything that can force a product commit first, then freeze, then one final record. Eval = B
  (pass^3 now, before the final records).
- **1A:** `workspace-up` starts new projects in accepted revisions.
- **2A:** v2 opens a format-1 project view only, with one-button Update project (owner/admin). A 1.x hub means
  update the server first. A **local** format-1 project is view only + Update project and is never migrated on
  open. `maude/v2-michal-1a-2a-format-gate-one-button-migrate`
- **Lead calls under 2A:**
  - a brand-new project takes its creator's declared format (`maude/v2-new-project-format-from-creator`);
  - a cell's Update project raises the cell hub at once (`maude/v2-p8-format-gate-full-gate`).
- **Real pushes and PRs** on `iagh66/maude-git-smoke` are allowed without asking
  (`maude/v2-michal-real-push-lifecycle-many`, `maude/v2-michal-smoke-repo-prs-no-ask`). Both lifecycle runs are
  green ×2.
- **Docker self-host gate V2-8.18** is a gate of its own (`maude/v2-8.18-docker-selfhost-gate`).

## Watch-outs learned today

- Never hold the test lane with one long run; give each journey its own slot.
- Resolve a dist merge conflict in ONE command (checkout --theirs + release rebuild + boot check + commit). The
  lane's dist guard reverts unmerged files (memory `maude-merge-conflict-vs-test-lane`).
- A `site/content/docs` edit needs `gen:stats` in the same commit, or 8.1 goes red.
- The keeper: Michal's studyfi-design sync runs on :4399 (`maude design server-up` from the global npm 1.9.1).
  Our harnesses start at 48399 (`MAUDE_PORT_BASE`).
- The Mac mini (`hub`) is unreachable over ssh; nothing in the final plan needs it.

Update 2026-10-28 ~17:00: HEAD 8f238f19a (sec-lows merged). Weekly 57 %, 5h 50 %. Still open before the eval: p8-format-gate-2, p8-journey-fixes.

Update 2026-10-28 ~21:00: HEAD 177b70038. p8-format-gate (2A+1A) merged 0c781ec4f (Docker gate 22/22, e2e 205/0, hub 1953/0); p8-journey-fixes and p8-feat-reds merged earlier. No builder running; every merged worktree removed (86 GB free). Weekly 60 %. Eval resumed 20:57 (54 trials, ETA ~23:00), keeper told. Final tooling staged in the scratchpad `rec/`: record.sh, the probe (compiled) and `chain4.sh` (8.1 → screen wait → 8.3 → **8.18** → 8.2; 8.18 needs the screen too: its desktop legs run inline). Michal's design server now runs on :4420 (pid 37375, `maude design serve`), not :4399.
