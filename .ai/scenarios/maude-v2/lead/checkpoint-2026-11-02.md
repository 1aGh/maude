# Lead checkpoint — 2026-11-02 ~16:10 — FULL HANDOFF (account switch)

This replaces `checkpoint-2026-11-01b.md`. The keeper reported the weekly usage at 95 %, so a new account may take over
from here. Michal said there are no more rounds before the final checks; the lead runs them and reports to the keeper
(the peer session "Maude v2 keeper").

## UPDATE ~17:10 — the final round is DONE

- 8.7 (318/318), 8.8 (WebKit 21/21 vs 47/45), 8.14 (budgets; LOD +1 ms as accepted) and 8.10 (the final `.app` at
  71ec8ec75, scripted half green) are attested. **`node scripts/v2-gates.mjs --status`: all 15 green.**
- `v2-done.sh` on `feat/maude-v2`: everything passes except the two items that wait on Michal. These are expected:
  - ledger row **V2-8.13** (close-out after the merge);
  - **`packaged-app.json` pass** (his clean-user smoke).
- PR.md, the verification table and the PR #160 body are up to date. The PR is still a draft.
- The Progress log and the r4/r5 checklist have a final-state section.
- Nothing is left running.

The only things left are Michal's: the clean-user smoke of the final `.app`, the VoiceOver listen, his look at the
r4/r5 rows in this build, and the merge. After the merge: V2-8.12 (cut `2.0.0-rc.1`) and V2-8.13 (`/flow:done`).

## Where things are

- `feat/maude-v2`: the product tree is **`71ec8ec75`**. Every commit after it touches only `.ai/`. Pushed.
- PR 1aGh/maude#160 is still a **DRAFT**. The merge is Michal's; never merge it and never take it out of draft.
- Worktrees:
  - `.claude/worktrees/lead-merge-2` (branch `lead-merge-2`): every commit goes here first, then
    `FARM_LOCAL=1 git merge --ff-only lead-merge-2` in the main checkout (on `feat/maude-v2`), then
    `GH_TOKEN=$(gh auth token --user 1aGh) git push`.
  - `.claude/worktrees/freeze` (detached at `71ec8ec75`): chain4, perf and the `.app` run from here. Gate JSONs land here
    **uncommitted**. Copy them to lead-merge-2 and commit them before you ever `git checkout -- .` in the freeze
    (memory `maude-freeze-move-wipes-gate-records`).
  - `.claude/worktrees/a11y-run` (detached at `fa52b24c6`): the a11y matrix. `run-final.sh` moves it to the sha you pass.

## Green at 71ec8ec75 (committed in `.ai/scenarios/maude-v2/gates/`)

| gate | how |
| --- | --- |
| 8.0 cleanup | live check: 0 B of dead CSS (two `.insp-pop-custom` rules were removed in 62146d9d4) |
| 8.1 quality | recorded at 71ec8ec75. The full apps/studio suite on the mini at 62146d9d4: 21688 pass, 0 fail |
| 8.2 Rust, 8.18 Docker (22/22 legs) | recorded at 71ec8ec75 |
| 8.3 desktop e2e ×3 | recorded at 71ec8ec75: 3 runs green, prefs untouched |
| 8.4 cross-shell | attested; run on the mini at 62146d9d4: 18/18, format 1 14/18 (the view-only gate) |
| 8.5 fidelity | attested; browser e2e ×2 on the mini at 62146d9d4: 47/48, plus the port-bind red rerun ×2 green |
| 8.6 nothing-deleted | live, 100 % |
| 8.9 security, 8.15 docs, 8.16 AI parity (512/512) | attested at 71ec8ec75 |

The diff 62146d9d4..71ec8ec75 is three desktop e2e harness files: the edit-artboards double-click retry, the
`helpers/assistant.ts` icon re-click, and the ai-runs Mac 2 page timeout raised to 60 s.

`PR.md` § Verification has been rewritten for 71ec8ec75 (b169f21c0). Only the rows for **8.7, 8.8, 8.10 and 8.14 still
describe the old run.**

## Still open, in order

1. **Perf 8.8 + 8.14.** `handoff-scripts/perf-chain.sh` was started at 15:53 at the freeze head (log:
   `<old scratchpad>/perf-chain.log`, evidence in `.ai/plans/notes/v2-evidence/p8-perf/freeze-71ec8ec75*` and
   `webkit-71ec8ec75-{ab,ba}` in the freeze). If it died with the session, re-run it.
   - It needs the Alligators clone at `<old scratchpad>/allig/a` (9.1 GB). If the scratchpad is gone, recreate it as the
     previous perf notes describe (`.ai/plans/notes/v2-evidence/V2-8.8-perf.md`, `V2-8.14-perf.md`).
   - Nothing else may run during perf. The WebKit lane needs the display on.
   - Compare against the last attest: WebKit p95 22/20 ms vs pre-v2 48/45; Chromium studio 18.1 vs 18.2, bare 16.7 vs
     16.8; LOD base-v2 +1 ms accepted by Michal; index/covers/artboards/tiles budgets.
   - r3–r5 changed zoom (K: `--dc-zoom: initial`) and the picker, so look closely. Then update `V2-8.8-perf.md` and
     `V2-8.14-perf.md` and run `--attest V2-8.8` / `V2-8.14` with those files as `--report`.
2. **A11y 8.7.** `handoff-scripts/a11y/run-final.sh 71ec8ec75` (stale since efac0124). Re-scan any BLOCK with
   `run-one.sh <sha> <regex>`. A run at 62146d9d4 was stopped half-way; the dark `tool-*` rows showed only
   "incomplete: color-contrast" (axe could not decide), not violations. Update `V2-8.7-a11y-final.md`, then
   `--attest V2-8.7`.
3. **Final .app 8.10.** `handoff-scripts/app-build.sh` (the `MAUDE_NO_AUTO_UPDATE=1 pnpm build:desktop` build fails
   only at updater signing). Then:
   - `bundle-completeness --smoke`, `client-boots`, `nm`/strings for wdio = 0;
   - `node apps/studio/test/e2e/opening-card-clears.mjs` against the release client;
   - update `.ai/plans/notes/v2-evidence/V2-8.10-app-final/README.md` and `.ai/scenarios/maude-v2/packaged-app.json`
     (head, built; `pass` stays **false** until Michal's clean-user smoke);
   - `--attest V2-8.10`.
4. **PR.md**: rows 8.7, 8.8, 8.10, 8.14. Then the PR body:
   `GH_TOKEN=$(gh auth token --user 1aGh) gh pr edit 160 --repo 1aGh/maude --body-file .ai/scenarios/maude-v2/PR.md`
   (keep it a draft).
5. **Close-out bookkeeping**: the plan's Progress log line (`.ai/plans/feature-maude-v2-redesign.md`), the r4/r5 rows
   in `lead/r4-michal-findings.md` marked verified, `node scripts/v2-gates.mjs --status`, `bash scripts/v2-done.sh`.
6. **Report to the keeper** (SendMessage "Maude v2 keeper").

**v2-done.sh will NOT exit 0 yet, and that is expected.** Two checks wait on Michal:
- `packaged-app.json` `pass` needs **Michal's clean-user smoke** (a fresh macOS user, no node/bun/brew/claude).
- ledger row **V2-8.13 Close-out** is "after the merge".

The **VoiceOver listen** (8.7) is also Michal's. Report these as "waiting on Michal", not as red.

## How-to (scripts copied to `lead/handoff-scripts/`; each hard-codes the old scratchpad path `S=` — change it)

- **chain4**: `rec/chain4-f.sh` (8.1 → screen probe → 8.3 via `rec/record-f.sh` → 8.18 → 8.2), or `rec/chain4-from83.sh`
  to skip 8.1.
  - Wrap it in `caffeinate -dims`.
  - The probe binary is `lead/tools/probe.swift` (`swiftc -O probe.swift -o probe`).
  - It waits until Arc and Blender are closed, plus 3 clear minutes.
  - Lane logs: `$TMPDIR/maude-v2-8.3/<ts>/`.
  - In `probe.log`, `apps=0` samples are app restarts (benign); `front=Claude` with `apps=1` means the window was covered.
- **fast gates** after any product commit: `gates-sg.sh` (tsc, gen-actions, gen-surfaces, biome, coherence, boot) +
  `node scripts/check-v2-nothing-deleted.mjs` + `node scripts/v2-css-inventory.mjs --report` (must say 0 B dead).
- **freeze move**: commit the gate JSONs first, then `git checkout -q -- . && git checkout -q --detach <tip> && bash fz/pre.sh`.
  pre.sh regenerates the site stats; commit any diff it leaves.
- **mini** (`ssh hub`, display-free): `remote/r6-mini.sh` (8.4 both formats + 24 browser e2e ×2); the full suite:
  `FARM_LOCAL=1 scripts/remote-lane.sh --rev <sha> --slot 1 --max 5400 -- bash -c 'export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1; cd apps/studio && bun test --isolate --timeout 20000'`.
- **attest**: `node scripts/v2-gates.mjs --attest V2-8.x --report <files> --note "..."`. Run it in lead-merge-2 and
  commit the JSON.

## Rules that still bind

- Never touch `~/.config/maude` or Michal's credentials, `hubs.json` or keychain. No real hub, cell, Stripe or
  Cloudflare. Never push images.
- Every spawn uses a throwaway HOME/XDG, `NO_OPEN=1`, `MAUDE_NO_AUTOBUILD=1` and a stub `claude`.
- Never kill another session's processes; kill by pid, never `pkill -f`.
- No local test-lane run while chain4 or perf runs.
- Mouse-moving steps only after Michal says "muzes".
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage specific files only.
- `FARM_LOCAL=1` on local heavy commands. Use figga only from a clean freeze, never with `--with-env`.
