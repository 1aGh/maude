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

## HANDOFF ~19:40 — lead stopped on Michal's word (move to another account)
**feat/maude-v2 tip: 5e836e3af** (on top of Michal's own 5b2c24de1 ux-patterns commit). No freeze is in progress and nothing
is running: no wdio, caffeinate, lane or mini process. Weekly usage 59 % at the stop.

**Done today since the sweep:**
- Sweep closed: 5857 found, 0 DEAD, 0 not reached. The final breakdown went to Michal via the keeper.
- Security pair batch-2: 0 blockers. Every low/info fixed (`V2-8.9-batch2-{defender,attacker,fixes}.md`).
- Five desktop-e2e reds fixed:
  - video-ai-cut-stop (spec);
  - cloud-attach (hub file-limits own bucket);
  - ai-runs (spec);
  - edit-multi (canvas boot refit);
  - relaunch (one navigation per tab).
- Also fixed: the dist-freshness whitespace rule.
- Last freeze 41be8375e: 8.1 PASS; 8.3 run 1 green over all 42 lanes, run 2 red only on relaunch, now fixed in 5c2f0b567.

**Exact next step:**
1. Push feat (if Michal OK'd publishing 5b2c24de1 — see below).
2. Move the freeze worktree to the tip:
   `git -C .claude/worktrees/freeze checkout --detach <tip>`.
   Its pnpm/bun installs and the shared cargo target are already there; re-run `CI=true pnpm install --frozen-lockfile
   --prefer-offline` only if a lockfile changed.
3. Pre-checks: parity, tarball, containment, coherence, biome, site gens with no diff.
4. chain4 FROM THE FREEZE WORKTREE: `bash $S/rec/chain4-f.sh` (8.1 → 8.3 ×3 under `caffeinate -dimsu` → 8.18 → 8.2).
   Never from the main checkout. Michal works there.
5. Re-attests: 8.4, 8.5, 8.8?, 8.9 (batch-2 is done; re-check only the relaunch/edit-multi/cloud-attach delta),
   8.15, 8.16, plus the solo `format-update.e2e.ts`.
6. A new .app with `MAUDE_NO_AUTO_UPDATE=1`, then `check-bundle-completeness --smoke` and `check-client-boots`.
7. PR.md / READY TO TRY / pr-followups.
8. Keeper. The PR stays a draft.

**Syncthing hazard (new):** `.git` is synced between Michal's machines. At 19:29 it overwrote `refs/heads/lead-merge-2`
with an older value; the right value was in `refs/heads/*.sync-conflict-*` and was restored from the reflog. Before
trusting a branch, compare `git reflog -1 <branch>` with `git rev-parse <branch>`.

**Michal's work:** `plugins/design/skills/ux-patterns/` + critic agents + references + `.gitignore` are now HIS commit
5b2c24de1 on feat. `.ai/research/` stays local. Don't edit, revert or rebase his commit.

## Resumed ~19:56 on a NEW account (Michal: "at pokracuje")
The weekly usage restarted from a new base: 3 % at the resume (the old account stopped at 59 %). The freeze tip was the
d74f6f47a handoff + a gen:stats commit (70d121f00) (the ux-patterns skill moved design skills 42 → 43). Michal OK'd publishing 5b2c24de1 (the skill is on main as d3a5029b0, feat holds its v2 shape); feat pushed at
70d121f00. chain4 on 70d121f00: 8.1 PASS, 8.3 run 1 stopped on share-roles: dist freshness counted a markdown contract
edit under client/ (5e836e3af) as client source. Fixed (markdown excluded like CSS); new freeze follows.

## Update 2026-10-31 ~01:30 — freeze e04d5926c
- 8.18 red at 4b373909f fixed by p8-docker-desktop-legs (a hub's paired studio never writes its checkout's config.json;
  team-project owns its teammate child + log; selfhost-entry opens closed folders). Merged + pushed e04d5926c. kg:
  `v2-p8-docker-desktop-legs-paired-studio-no-config-seed`, `v2-p8-docker-desktop-legs-team-conf-owns-its-child`.
- chain4 on e04d5926c: ALL GREEN — 8.1, 8.3 ×3 (locked=0, display_off=0, prefs/appsup unmoved), 8.18, 8.2.
- Re-attests: 8.15 PASS (re-check section in `V2-8.15-docs.md`).
- **8.4 RED** (rig, local, `$S/att/p84.sh`): 5/18, deterministic ×2 — owner of a local cell with a format-2 checkout
  sees "View only — still saves the old way"; browser Edit click selects nothing in the Inspector; owner + viewer
  comment never listed. Evidence `freeze/.ai/scenarios/maude-v2/V2-8.4-freeze/` + `$S/att/p84-out2/`.
  Builder **p8-p84-reds** (Opus, worktree) diagnosing + fixing.
- Security pair (defender + attacker) running on `3a4e42e23..e04d5926c` (8 product files + the ux-patterns skill).
- Next: merge p8-p84-reds → new freeze → pre-checks → chain4 again → 8.4/8.8/8.5/8.16 + 8.9 recheck of the fix → .app.
