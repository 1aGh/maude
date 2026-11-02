# Lead checkpoint — 2026-11-02 (final round, after r3–r5)

Supersedes `checkpoint-2026-11-01b.md`. Michal: no more rounds before e2e. The lead runs the final checks and reports to
the keeper.

## Tip

`feat/maude-v2` product tree **`62146d9d4`** (the dead `.insp-pop-custom` CSS removed for V2-8.0). Later commits touch
only `.ai/`. PR 1aGh/maude#160 is still a draft; the merge is Michal's.

## Done at 62146d9d4

- V2-8.0 PASS (0 dead CSS bytes), V2-8.6 PASS (100 %).
- V2-8.9, 8.15, 8.16 re-attested (04b83bc86). The diff since aeb2ba166 is the edit-shapes spec plus the dead CSS.
- Full apps/studio suite on the mini at c5e148c68: 21688 pass, 0 fail. Lane e2e at be9824591: 52/53; edit-shapes then
  fixed in c75986f34 (4/4 alone).

## Running at checkpoint time

- chain4 at 62146d9d4 (`scratchpad/rec/chain4-f.sh`, log `scratchpad/rec/chain4.log`): 8.1 → screen probe (Arc and
  Blender closed) → 8.3 ×3 → 8.18 → 8.2. **Gate JSONs land in the freeze worktree uncommitted. Copy
  `.ai/scenarios/maude-v2/gates/V2-8.{1,3,18,2}.json` into lead-merge-2 and commit before you move the freeze.**
- Mac mini (`scratchpad/remote/r6-mini.sh`): 8.4 in v2 and format 1, plus all 24 browser e2e ×2 at 62146d9d4. Evidence
  is fetched into lead-merge-2 `.ai/`.

## Still to do, in order

1. Commit the chain4 gate JSONs. Attest 8.4 and 8.5 from the mini results.
2. Perf 8.8 and 8.14 (`scratchpad/perf-chain.sh` at the freeze head). These are stale since fab4e6c4, and r3–r5
   changed UI and zoom (K: `--dc-zoom: initial`). They need a quiet Mac, so run after chain4.
3. A11y 8.7 (`scratchpad/a11y/run-final.sh 62146d9d4`, then re-scan any BLOCK with `run-one.sh`). Stale since efac0124.
4. The final `.app` (`scratchpad/app-build.sh`, opening-card-clears, nm for wdio) → attest 8.10, then update
   `packaged-app.json` and `V2-8.10-app-final/README.md`.
5. The PR.md verification table, then the PR body (`gh pr edit 160 --body-file`, with GH_TOKEN from 1aGh). Keep it
   a draft.
6. The plan's Progress log, the r4/r5 checklist rows marked verified, the ledger row V2-8.13, then `v2-done.sh`.
7. Report to the keeper.
