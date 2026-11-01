# Lead checkpoint — 2026-11-01 (b)

> **Update 23:40 — A B C D F merged (0a00e37f7, release bundle rebuilt); G (#6), H (#15–#18), I (#13, img 44), E (#5 LOD) running.** Earlier: **Update 22:00 — the budget stop is lifted** (Michal: "zadny limit nedavej, pokracuj az 100% pak kdyztak prehodime ucet"). r4 is running: builders A r4-dnd (Opus, #2), B r4-ds-create (#10 #11 #7), C r4-signin (#8 #9a), D r4-small (#3 #12 #14 #1), E r4-lod-perf (#5 / the LOD regression), F r4-color-picker (#4), all in their own worktrees from 6763174c2. Next: #6 (global Light/Dark), then #13 #15–#18 img 44. Status per item: `r4-michal-findings.md`. If the session moves accounts: the builders' branches are `worktree-agent-*` in `.claude/worktrees/agent-*`; merge each in lead-merge-2 with gates-sg, then `.app` to Michal before chain4.

(Original, weekly budget at 82 %:)

Paused on the keeper's signal ("dokonči rozdělané, checkpoint, při 85 % pauza"). Resume after the reset
**2026-11-06 09:00**. PR 1aGh/maude#160 stays a draft; the merge is Michal's.

## Where things are

- **feat/maude-v2** — pushed through the r4 checklist commits (see `git log`). Round r3 (Michal's 7 findings on READY TO
  TRY 11) is merged, verified and shipped as **READY TO TRY (12)**: `Maude.app` 2.0.0-rc.1 built at `fa52b24c6`
  (`.claude/worktrees/freeze/apps/desktop/src-tauri/target/release/bundle/macos/Maude.app`).
- After `fa52b24c6` (not in Michal's .app): the comment-trash double-click fix (1e8ebbe92 + bundles 46c5a7dcc), the
  browser clipboard-drop e2e step, docs for r3, gate evidence.
- **Gates at the tip** (`node scripts/v2-gates.mjs --status`): 8.0 8.4 8.5 8.6 8.7 8.9 8.15 8.16 PASS (re-attested for
  r3). Stale only because files moved after `fa52b24c6`: 8.1, 8.2, 8.3, 8.18 (chain4 was green AT `fa52b24c6`, recorded in
  037690524) and 8.10 (the .app at `fa52b24c6`, attested in b5d6286e6). 8.8 / 8.14: the perf chain at `fa52b24c6` was
  running at the pause (`scratchpad/perf-chain.log`; index bench 2 runs ok, the Chromium v2-base step returned rc=1 —
  read `scratchpad/perf-chromium.log` before attesting; panel + 12 people tables look in budget).
- **Next gate step at resume** (gate policy, `lead/gate-policy.md`): r4 is a new round of product changes, so: builders →
  quality (figga lint/tsc, mini full suite) → **the .app to Michal before chain4** (his explicit order) → his findings →
  chain4 → re-attests. Do not carry the r3 records over r4 product changes.

## PERF REGRESSION found at the pause (read first at resume)

The perf chain at `fa52b24c6` finished after this checkpoint was written (`.ai/plans/notes/v2-evidence/p8-perf/
freeze-fa52b24c6*`, `webkit-fa52b24c6-*`): studio, bare, peers, panel, index and **WebKit both orders PASS** (p95 23 / 22
vs pre-v2 48), but the **Chromium LOD lane FAILS in both orders** — mixed board, 1,500 elements / 64 artboards, fit-all
below 25 %: p95 **83 ms vs pre-v2 34 ms**, long frames **30 vs 2** (it was PASS / +1 ms accepted at `08b35c8db`). So r3
regressed the far-zoomed many-artboard case; it is very likely the same thing Michal felt as **r4 #5** ("zoom … extreme
sekany" on the DS canvas). Prime suspect: r3's DS-rows change in `canvas-lib.tsx` (4ab29ab09) — the artboard-name
collapse rule (`min()` against the zoom on every artboard label) or the `flowRows` effect re-running per render/zoom
step. **First thing at resume:** bisect 4ab29ab09 with `scripts/v2-perf-bench.sh --lanes lod` (revert the label rule
alone, then the effect), fix, re-run lod + `perf.sh` on `.design/system/maude-v2`. 8.8 / 8.14 stay red until then.

## r4 — Michal's 18 findings on READY TO TRY (12)

Item-by-item state is in **`lead/r4-michal-findings.md`** (every item `open`; nothing was started before the pause).
Michal's decisions, recorded in kg:

- #4 colour picker → exactly Figma's (`decision:maude/v2-michal-r4-color-picker-figma`), no mock first.
- #6 Light / Dark → one pill at the top of every canvas, the DS canvas's place and form; drop Follow chrome / DS default
  from Advanced; the default comes from the DS (`decision:maude/v2-michal-r4-global-light-dark`).
- #9 Maude Cloud sign-in → (a) show the same code in the app; the device flow stays
  (`decision:maude/v2-michal-r4-cloud-signin-show-code`).

**Plan at resume** (sent to the keeper; builder brief at `lead/briefs/r4-common.md`):
1. Four builders in parallel: **A (Opus) #2 drag and drop** — reproduce in the RELEASE .app first (Finder → canvas,
   Assets → artboard, Edit and Preview). The tab webviews already `disable_drag_drop_handler()`, so it is not Tauri's file
   drop; r3's guard drove a plain WKWebView, not the packaged app. The new guard must drive a real OS drag (CGEvent) into
   the packaged app — that moves the mouse, so only while Michal is away (tell the keeper first). **B #10 + #11** (AI
   setup-ds wrote a v1 static page: which plugin copy the ACP session loads, DDR-168; Convert refreshes the view and
   explains why; the AI conversion locks only the DS). **C #8** alligators hub sign-in (disabled fields, placeholder
   under the icon). **D small batch** #3 (scrub selects text), #12 (More menu closes on an outside click), #14 (Esc in
   Preview with nothing selected), #1 (a way to play a video placed on an artboard).
2. Then #4, #6, #9 (decided), #5 (DS-canvas zoom stutter: measure on `.design/system/maude-v2` with `perf.sh`), #7, #13,
   #15–#18, img 44.
3. Michal: "hlidej at se opravdu vse implementuje" — every checklist row needs how it was seen in the release .app.

## Worktrees and processes

- `.claude/worktrees/freeze` at `fa52b24c6` (perf runs from it), clean apart from untracked evidence.
- `.claude/worktrees/lead-merge-2` — the merge worktree (branch `lead-merge-2`, fast-forwarded into feat each time).
- `.claude/worktrees/a11y-run` at `fa52b24c6` — the a11y matrix worktree (keep; `scratchpad/a11y/*.sh`).
- `.claude/worktrees/agent-a406418011d3e3540` — the r3 fill-label builder's, merged (e33806808), still locked by its old
  agent pid: `git worktree remove -f -f` it at resume.
- A `maude-perf-bench.*/base` worktree under TMPDIR belongs to the running perf chain (it removes it itself).
- Mac mini: nothing running (stale clip-e2e servers reaped); Playwright cache present (chromium_headless_shell-1228).
- Running at the pause: only the perf chain (`bwch1d24m`). Nothing else.

## Follow-ups added this round

`lead/pr-followups.md` § "From round r3": `declared.background` shape cap, the `p8-hub-undo-collision` setup timeout,
the WebKit drag guard's setup stall, a bare-canvas video drop, the `dsPreview` catcher block, the canvas-tools T15 ⌘D
order flake.
