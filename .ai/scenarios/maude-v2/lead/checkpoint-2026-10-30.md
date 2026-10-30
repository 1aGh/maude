# Lead checkpoint 2026-10-30 ~01:30 (continues checkpoint-2026-10-29-batch.md)

Integration branch `lead-merge-2` (worktree .claude/worktrees/lead-merge-2) now holds, on top of feat 34f79beef:
lint fixes, fix-c2 + fix-c3 (restore rig 4/4), held-conflict-status, hub-drafts, selfhost-convert (+ collector
`disabled=`), ia-edges, import-link (+ security-pair fixes), a1-save-hold, v1-drop-desktop (+ 18 gesture tests),
write-claim scope split (yjs out of the helper closure), import-link role-refusal row. tsc/gens/biome/boot green.
Verification batch on the mini: bonpoc70l → scratchpad/mini-merge2c.txt. Green → ff feat to lead-merge-2 + push.

Running builders:
- p8-suite-green (Opus): full studio suite 0 fail on macOS (pre-existing cascade, ~490 timeouts on feat too) +
  the 12 CI Linux fails + the test that clobbers dist in CI. Hint sent: window.__TAURI__ leaks across files.
- p8-sweep-final (Sonnet): last dead control (Preview label selects — kg v2-p8-leftovers-preview-label-selects),
  plant-dead self-test, crawler exit 0. Then merge p8-sweep-leftovers + p8-sweep-final.

Open with Michal (via keeper): link import in cloud cells (A refuse = default built; B allow).
Owed in chain4: solo desktop e2e `format-update.e2e.ts`. Security pair over the whole batch after the freeze.
Michal: screen window needs no announcement; caffeinate -dimsu around 8.3; stop + tell keeper if the screen locks.

## Update ~03:30
- **p8-suite-green merged + pushed (f583ddc5c).** Full studio suite on the mini as CI runs it: 20935 pass / 0 fail
  (`bun test --isolate`). The 490-fail cascade was plain `bun test` without `--isolate`; the preload now stops such a
  run with one line. The 12 CI Linux fails fixed (one real bug: the annotations converter called you "You" instead of
  localAuthor). kg: 4 v2-p8-suite-green-* decisions. CI Quality on f583ddc5c is running — check it; items 4 (ab-park
  race: read the printed skip reason) and 11 (compare-view theme, not reproduced) are proven only on CI.
- Still running: p8-sweep-advanced (a96ea76e…) — every one of the 1107 controls in one class, 3 destructive unit
  tests, the 14 Advanced rows. On hand-back: merge, then send Michal the completed sweep summary via the keeper.
- Then freeze → chain4 (no announcement, caffeinate around 8.3) → re-attests → .app → PR.md.

## Update ~08:05
- CI Quality on feat 10545350a: 12 → 6 studio fails on Linux. Left: U7 ×4 (`/_api/assets` order on ext4), U21 ×2
  (restore on Linux), and hub `acl-u6-proxied-sockets` ×2 (a socket close never fires). → builder **p8-ci-linux-2**
  (Opus). p8-ab-park-race now skips on CI with its reason (Chrome needs --no-sandbox in the runner) — accepted.
- Orphaned `_thumbs-playwright` processes (keeper): the shim is fine (it exits with its server's stdin). The leak is
  that a project/Home server never notices its parent died (Maude.app crash/SIGKILL → sidecars live forever).
  → builder **p8-orphan-sidecars** (Opus): parent-death watch for shell-spawned servers + `MAUDE_EXIT_WITH_PARENT=1`
  for rigs. Killed the orphan 7406 (+ shim 7894) from the removed worktree a416.
- p8-sweep-advanced is alive (crawls on mini); asked it to kill stale shards + its 02:13 local rig, hand back by ~10:00.
- Running (3): p8-sweep-advanced, p8-orphan-sidecars, p8-ci-linux-2. Freeze after all three merge.

## Update ~09:50
- Pushed to feat `40c01a63f`:
  - p8-orphan-sidecars (ppid watch; `MAUDE_EXIT_WITH_PARENT=1` for rigs).
  - p8-ci-linux-2 (listing name tie-break; watcher trailing delivery; U6 hub test).
  - p8-sweep-advanced (14 Advanced rows reached; frozen fixture per state; 10 no-op controls fixed).
  - Lead fixes:
    - surface catalogue regenerated;
    - containment, where a cell gets no rects runner for export-preflight and the pin now lists the 4 v2 export routes (kg `v2-p8-containment-v2-export-routes`);
    - site stats/whats-new regenerated;
    - the e2e-live-lanes hub tests skip with a reason on a CI runner without Node 24.
- **Why CI kept finding "new" failures:** each Quality step stops the job, so the steps after a red one never ran. Before the freeze, run the WHOLE quality.yml step list locally:
  - `pnpm test` (node + hub + test:harness)
  - `scripts/test`
  - `apps/cells`
  - `check-containment`
  - `check-cloud-binary`
  - `tsc` + `check-tsc-coverage`
  - the sync lane
  - `hub-restore-drill`
  - `tarball`
  - `parity`
  - `coherence`
  - the token checks
  - `ds-check`
  - the site gens (call the `node site/scripts/*` scripts directly in a worktree, because pnpm is broken in a symlinked worktree)
  - the site build (run it in the main checkout)
- Sweep totals so far: 5853 found, all classed. Open: DEAD 1, not reached 230. An interim breakdown went to the keeper for Michal.
- Running:
  - **p8-sweep-errors** (Opus): edit-op 409 ×22, insert-sequence 422, thumb 404, 13 reasonless disabled menu rows, the vh-row-r4 DEAD.
  - **p8-sweep-finish** (Sonnet): the 230 states, merged report, crawler exit 0. Shard JSONs are in `lead/dc-shards/` (untracked — never commit them).
- CI Quality is running on 40c01a63f (monitor). The superseded runs were cancelled.
- Then: the full quality.yml list locally → freeze → chain4.

## Update ~13:00
- p8-sweep-finish merged + pushed (feat 42a2b28e5, + biome format). kg: v2-p8-sweep-finish-{resume-seeds,redo-supersede,rig-restart-tags}.
- Sweep: 5858 found; 1 DEAD (adv-copy-style, tauri), 3 not reached (post size-picker-tile states), 2 error findings
  (/_health CORS probe in use-shell-core.jsx = real client bug; one-off edit-op 400 "not on this canvas").
- Interim breakdown sent to the keeper. Running: **p8-sweep-close** (Opus) on all four → crawler exit 0.
- Its shard sources: `.ai/scenarios/maude-v2/lead/dc-shards/` + worktree agent-ad8c3a6547dc5be3e `dc-out/` (remove that
  worktree only after p8-sweep-close hands back).
- Next: merge sweep-close → final breakdown to keeper → freeze → chain4.
