# Lead checkpoint, 2026-10-31 late: UX audit fix round in flight

feat is at `c2ed7c268`, pushed. The merge worktree is `.claude/worktrees/lead-merge-2`. Freeze worktree `.claude/worktrees/freeze` is still at `20b4215eb` and is stale.

## Done since checkpoint-2026-10-31b
- Text-tool blocker F01: merged `ab1e36583`.
- Comments P4: merged `00dd72435`.
- Verify-in-app P0: all 6 pass, spec lane `e2e:ux-audit`. It also fixed a missing DEDICATED entry for `wdio.shell-panels.conf.ts`, which made every wdio lane throw. Merged `4a4d2614d`.
- Michal's decisions on the debate: `.ai/plans/notes/v2-evidence/ux-audit-rc1/MICHAL-DECISIONS.md`, plus kg `v2-michal-ux-audit-td-decisions`. Summary:
  - keep Preview;
  - icon-only switch with a readable state;
  - a key acts in the current mode when it means something there, otherwise it crosses;
  - only the toolbar changes;
  - the rest as starred, with Inspector T0–T3 before merge.

## Running builders
All are Agent tool, background, in their own worktrees.

| Name | Package | Scope |
| --- | --- | --- |
| `r2-p1-create` (Opus) | P1 | TD3 neutral new-object defaults; TD10 "Artboard / Frame (F)", File › New artboard, Image opens a file picker |
| `r2-p2-first-canvas` | P2 | TD2 empty Untitled canvas plus the brief in ⌘K; TD4 two-width Canvases fold; Home New project; the full-suite "index churning" test |
| `r2-p3-modes` (Opus) | P3 | TD1b/c/d icon switch state, the per-key table, toolbar-only switch; TD5 no What's-new toast; TD9 focus ring and menu border; stale `toolbar-ink-more` e2e; full-suite "G5 chat groups" test |
| `r2-p5-menus` | P5 | TD6 Export; TD8 Maude Cloud / Move to Maude Cloud…; ⌘K cleanup. Merge **after** P2, since both touch TESTIDS. |
| `r2-p6-inspector` (Opus) | P6 | Inspector T0–T3 per `lead/inspector-ux-rules.md` |

The briefs for every builder are `lead/brief-michal-rc1-findings.md` + `ux-audit-rc1/REDUCE.md` + `MICHAL-DECISIONS.md`.

## Open questions for Michal (via the keeper)
- Esc on an existing inline text: (a) keep the words everywhere, as in Figma (recommended), or (b) the current split. Also listed in `pr-followups.md`.

## Merge recipe and lessons from this round
- Merge in `lead-merge-2` with `FARM_LOCAL=1 git merge --no-ff <branch>`. After each merge, `bash $S/gates-sg.sh`. `S` is the session scratchpad `/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad`. If it is gone, run tsc, gen-actions --check, gen-plugin-surfaces --check, `npx biome check .`, check-import-coherence, check-client-boots-source.
- Every merge so far needed `npx biome check --write <files>` for import order, and new testids outside `client/v2` need a `V2_CODE_IDS` entry in `scripts/v2-manifest/map-rules.mjs` (nothing-deleted). To find them, print `unmapped` from a temp copy of `check-v2-nothing-deleted.mjs`.
- Then ff the main checkout and push with `GH_TOKEN=$(gh auth token --user 1aGh)`. Remove the merged worktree and branch.

## Next steps
1. Merge P1, P2, P3, P5 (after P2), P6. Record their kg decisions.
2. Run the **full studio suite on the mini** at the tip (chain4 doesn't run it; see memory `maude-chain4-skips-full-suite`):
   `FARM_LOCAL=1 scripts/remote-lane.sh --rev HEAD --slot 1 --max 3600 -- bash -c 'cd apps/studio && bun test --isolate --timeout 20000'`
3. Move the freeze to the tip.
   - Back up the untracked/modified `.ai` evidence in the freeze with tar, then `git checkout -- . && git checkout --detach <tip>` and restore.
   - The old evidence has all been committed to feat already.
4. Run the pre-checks (`$S/fz/pre.sh`), then chain4 (`$S/rec/chain4-f.sh`): 8.1 → 8.3 ×3 → 8.18 → 8.2.
5. Re-attests. The previous attest commands are in this conversation's history and in the gate jsons' notes.
   - **On the mini:** 8.4 and 8.5 browser e2e (`$S/remote/p84-remote.sh`, `browser-remote.sh`). WebKit 8.8 on the mini needs Michal's GUI-session `safaridriver -p 4488`, so ask the keeper.
   - **Here:** Chromium 8.8/8.14 perf and the index bench on the Alligators clone `$S/allig/a`. Strip `_state` before each run.
   - 8.7: the a11y matrix again, with the client changed. The driver is in `lead/a11y-driver/`.
   - 8.9: a security delta pair over the round.
   - 8.15 docs, 8.16.
6. Build the `.app` with `MAUDE_NO_AUTO_UPDATE=1 pnpm build:desktop` via the lane. Then run the bundle-completeness `--smoke`, the client boots check and the opening card check, and attest 8.10. `packaged-app.json` stays `pass:false` until Michal's clean-user smoke.
7. Update PR.md and the PR body (draft, 1aGh/maude#160), write READY TO TRY (11) with the Progress-log done lines and tasklist.json, and send a report to the keeper.

Budget: about 45 % of the week used at the start of this round.
