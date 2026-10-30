# Stage D harness, G5 (13 Design System, 14 Editing, 15 Annotations)

The stage-A scripts, copied from the stage-A worktree and repointed (`REPO` in `lib.mjs`, the `.scr/` paths) to the worktree they ran in
(`/Users/iagh/git/personal/maude/.claude/worktrees/agent-a57a21718e6d25731`, scratch in `.scr/`). Change `REPO` before reuse; `fx5.mjs` reads
`.scr/fx5/canvases` (here `fx5-canvases/`) and `lib.mjs`'s fixtures come from `apps/desktop/e2e/fixtures/project`.

Order used: release-build the client, `bun mk-dsconv.mjs` (the converted-system fixture), `chain-all.sh` (s13 a-g, s14a/b/c x 2 fixtures, s15 a b c e f, per theme),
`chain2.sh` (s13 h i j, s15 d, a re-run for dark after a browser crash, `dsboard.mjs` for the three whole-board frames), `mkpairs.mjs` (SPEC | IMPL pairs + committed JPEGs),
`mkstage-d.mjs` (the INDEX "After (stage D)" section + `full-size-path.txt`). `missing.sh` / `cmp.sh` list absent frames and size changes against stage A.

Only change from stage A: `run.mjs` dismisses the What's-new toast through its "Dismiss notification" button (the first button became "See all (3)" and opened the panel over the app).

## Round 3 (c3-inspect, V2-8.5) — 14 Editing re-shoot
Changed here: `g5.mjs` (`k.pageHit(id)`: a point on the artboard's PAGE itself; `k.click` now really holds its `modifiers`), `s14a.mjs` (ed-ab-arrange presses the page, which is an artboard press), `s14b.mjs` / `s14c.mjs` (the page is no longer a rung of the double-click ladder: each `k.deep(sel, n)` is one lower for a nested object, `see-work` = 4; several objects are ⌘⇧-clicked, a bare ⇧-click adds the TOP object), `mkpairs.mjs` (`ONLY_EXISTING=1` keeps the committed pair of an id the run did not shoot), `probe-c3.mjs` (prints the stamped chain depth of each drill target).
Use: copy into `.scr/`, set `REPO` in `lib.mjs`, `ln -s ../fx5-canvases .scr/fx5/canvases`, copy `.design` to `.scr/spec-root/.design`, `bun .scr/spec.mjs 14`, `bash .scr/chain14.sh`, `ONLY_EXISTING=1 bun .scr/mkpairs.mjs 14-editing`.

## Round 5 (c5-inspector, V2-8.5)
`s14a.mjs`: the artboard name is pressed by coordinates (a Playwright `.click()` on the label timed out waiting for actionability) and ed-ab-resize drags the right edge exactly to the Laptop 1280 preset (160 world px, scaled by the zoom), so the snap, the lit ruler stop and the bubble are in the shot. Spec shots: `bun .scr/spec.mjs 14` after `cp -R .design .scr/spec-root/.design`.
