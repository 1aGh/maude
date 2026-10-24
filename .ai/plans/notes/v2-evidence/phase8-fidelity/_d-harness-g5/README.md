# Stage D harness, G5 (13 Design System, 14 Editing, 15 Annotations)

The stage-A scripts, copied from the stage-A worktree and repointed (`REPO` in `lib.mjs`, the `.scr/` paths) to the worktree they ran in
(`/Users/iagh/git/personal/maude/.claude/worktrees/agent-a57a21718e6d25731`, scratch in `.scr/`). Change `REPO` before reuse; `fx5.mjs` reads
`.scr/fx5/canvases` (here `fx5-canvases/`) and `lib.mjs`'s fixtures come from `apps/desktop/e2e/fixtures/project`.

Order used: release-build the client, `bun mk-dsconv.mjs` (the converted-system fixture), `chain-all.sh` (s13 a-g, s14a/b/c x 2 fixtures, s15 a b c e f, per theme),
`chain2.sh` (s13 h i j, s15 d, a re-run for dark after a browser crash, `dsboard.mjs` for the three whole-board frames), `mkpairs.mjs` (SPEC | IMPL pairs + committed JPEGs),
`mkstage-d.mjs` (the INDEX "After (stage D)" section + `full-size-path.txt`). `missing.sh` / `cmp.sh` list absent frames and size changes against stage A.

Only change from stage A: `run.mjs` dismisses the What's-new toast through its "Dismiss notification" button (the first button became "See all (3)" and opened the panel over the app).
