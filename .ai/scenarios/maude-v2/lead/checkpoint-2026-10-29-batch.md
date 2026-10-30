# Lead checkpoint, 2026-10-29 ~17:15 — the fix batch before the new freeze (weekly 13 %, cap 85 %)

feat/maude-v2 is pushed at `0f4581d9c`. The integration worktree `.claude/worktrees/lead-merge-main` (branch
`lead-merge-main`) is used for merges: `git merge --ff-only feat/maude-v2` → `git merge --no-ff <branch>` → resolve
`dist/client.bundle.js` by keeping ours and rebuilding with `MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` →
tsc → `node scripts/check-client-boots-source.mjs` → ff feat + push. Prefix commits/tests with `FARM_LOCAL=1`
(otherwise the StudyFi hook refuses them). PR 1aGh/maude#160 stays a draft. Version 2.0.0-rc.1, untagged.

## Michal's binding rule (kg maude/v2-michal-before-merge-everything-works)
"Everything must work before the merge. Every button must do something, nothing may fail." Before the freeze, send
Michal (via the keeper) a summary of the sweep: number of controls / dead / fixed.

## Merged in this batch
- Held fixes; main merge + 2.0.0-rc.1 + version gate.
- DS menu (close + doors).
- Thumbnails at boot + index isolation + the MAUDE_NO_AUTO_UPDATE build switch.
- Update project fails loudly; ACP real-adapter proof.
- Export runtime (bundled Bun).
- Fix group A, the static sweep, fix group D, fix group E (E is merged in lead-merge-main but NOT yet pushed. Its
  tests ran in the lane in the background: brdjtqo36 — check them, then ff + push).
- Michal's index cleaned (2,280 entries) and 5 gone projects removed from the registry (backups in ~/.maude and
  App Support).

## Running (agents)
| agent | what |
| --- | --- |
| p8-sweep-dynamic | headless crawl of every control, table control → effect |
| p8-fix-b (ac31abfa…) | F5 proof + F17 note only (F7 DROPPED — v1 is out) |
| p8-fix-c | F14 empty file after restore on sync + F15 trash race |
| p8-a1-claims | A1: every writer verb claims its own writes + the AI trash claim (F17) |
| p8-dead-reasons | 96 disabled reasons → 0, history.object row, Keep this version (DS pin, sync) |
| p8-collab-epoch | handshake epoch (stale peers refused), both directions |

## Queue (start one as each slot frees up; max ~6 at a time)
1. **v1 drop, desktop part (Opus)**: automatic conversion on open per `.ai/plans/notes/v2-evidence/V2-8-v1-drop-scope.md`
   (approved: everything automatic; kg maude/v2-michal-drop-v1-auto-convert). Delete the dialog, legacy editing,
   legacy undo, offline-overlap, newerOnly; unflip the hub on failure; automatic DS convert; no-loop guard; cloud
   NEVER during the rc. Then sync/security review.
2. **v1 drop, cloud part (Opus)**: the stable 2.0.0 cell rollout converts every cloud project server-side
   (idempotent, a backup per project, converted/skipped/failed counts in the deploy log, a failure doesn't block).
   Docs in PR.md + `.ai/release-guide.md` 2.0.0 promote ("Verify the fleet actually rolled" style). Fail-first: the
   rc never converts the cloud; a second run changes nothing; one failure doesn't stop the others.
3. Port across rest/relaunch (`ProjectEntry.port`) + the index GC from the contract (unregistered + 30 days + gone
   root), with a pin test and a dry run on Michal's index.
4. Re-entry: "Update to Maude 2…" on the DS row ⋯ + ⌘K (only an unconverted system); "Update project" always from
   the project menu + ⌘K. Fail-first: after the dialog closes, the action is still reachable. (Mostly overtaken by
   item 1; keep only what still makes sense: DS ds-upgrade always reachable.)
5. Hub-linked annotation drafts as one ⌘Z step (projection/outbox).
6. Import from a link (Opus): https only, public addresses only (after DNS and every redirect), size/time limits,
   type by content, a privileged route through the route table, then a security pair.
7. The "Connect a Google key?" sheet (ia-edges H): Connect runs the waiting prompt.
8. Small: Figma not_found → the board's words + CONTRACT §3; a hub without a checkout → "This team server can't
   store media, so pictures and videos stay on this Mac." + stop retrying until the server changes.
9. **The 96 disabled reasons and Keep are running in p8-dead-reasons.**

## Then
New freeze → pre-checks (biome format, lint, gen:stats, gen-actions/surfaces --check) → tell the keeper the
time window for the screen (~1.5 h) → chain4 (`$S/rec/chain4.sh`: 8.1 → 8.3 ×3 → 8.18 → 8.2) → re-attests
(8.4, 8.5, 8.8?, 8.9 + security pair over the whole batch!, 8.15, 8.16) → a new `.app` built with
`MAUDE_NO_AUTO_UPDATE=1` + gates → PR.md / READY TO TRY / pr-followups (remove what's fixed) → a message to the keeper
for Michal. The ledger / Progress log: the new done lines and the gate records at the new freeze.

## Update ~18:30
- **Merged and pushed:** fix group E (6297cf41f) and fix group B, F4/F5 (d6c6f4346).
- **Merged in lead-merge-main, NOT pushed yet:**
  - p8-sweep-dynamic (b72791174), including the `share.open enabled: canvasOpen` patch.
  - Its tests are running in the background (bt4v5d2a8). After they pass: ff feat + push, remove the worktree
    agent-a0b5ef06a5eb2b137.
- **Ready to merge:** p8-dead-reasons (96→0 reasons, history.object row, Keep this version / dsKept, Choose another
  folder hidden). Worktree agent-a16b6ad0877771ae1. Record decisions: one-helper, known-objects, ds-kept.
- **Running:**
  - fix-c (trash restore/race);
  - A1 claims part 2 (Edit/Write claims at tool_call, ds-check/import-figma, interpreter window narrowed);
  - collab epoch;
  - **p8-v1-drop-desktop**;
  - **p8-v1-drop-cloud**;
  - **p8-sweep-leftovers** (timeline/generate dead controls, comp-media 400, compare without git, alert→toast, menu
    Paste via shell bridge, CSP media-src data:, the webrtc directive).
- **Queue still:**
  1. port + index GC;
  2. hub-linked drafts as one ⌘Z step;
  3. import from a link (+ security pair);
  4. the Google key sheet;
  5. Figma not_found words + the hub-without-checkout message/stop-retry.
- The re-entry item (DS convert / Update project) is folded into p8-v1-drop-desktop: ds-upgrade is always reachable,
  and project update is automatic.

## Update ~20:00
- Merged and pushed to feat `c7a51a7c7`: dead-reasons, fix-c, the dynamic sweep, collab-epoch, v1-drop-cloud, plus the
  cloud-lane pin fix.
- Running:
  - A1 part 2 (Edit/Write claims) `a6c2d80c…`
  - v1-drop-desktop part 2 (deleting the legacy lanes, DS auto + ⌘K ds.upgrade, loopback test) `a7c70936…`
  - sweep-leftovers `a2f8587a…`
  - fix-c2 `af7cbeee…`
  - port-gc `a08b0775…`
  - held-conflict-status "Not saved" + Compare + toast `a5fa1305…`
- Queue:
  1. **Self-hosted hubs convert at 2.0.0 too + kill switch `CELL_V2_CONVERT=0`** (cells + self-hosted, default on;
     documented in the release guide + self-host docs `design:self-host` / site; test: at 0 nothing converts and
     `/health` says so). kg maude/v2-michal-selfhost-convert-killswitch-held-conflict.
  2. Hub-linked drafts as one ⌘Z step.
  3. Import from a link (+ security pair).
  4. The Google key sheet.
  5. Figma not_found + the hub-without-checkout message.

## Update ~21:00
- A1 part 2 merged in lead-merge-main, NOT pushed; checks in b43dxb845 (tsc 0, gens ok; key suites waiting in the
  lane). After green: ff feat + push, remove worktree a6c2d80c….
- p8-port-gc done (worktree agent-a08b077538c5a4b5e, 90e6976f5 + f5c35414f), waiting to merge after A1. kg on
  merge: record-bound-port, index-gc-registry-from-rust.
- Running (6): v1-drop-desktop pt2, sweep-leftovers, fix-c2, held-conflict-status, selfhost-convert, hub-drafts.
- **New, before the freeze — Michal's A1 ruling (c) "hold the save"** (kg maude/v2-michal-a1-hold-save-during-interpreter):
  a person's save to a file a running interpreter call names is held until the call ends (+1 s) and lands as the
  PERSON's write; notice "AI is changing this file… your change saves when it's done"; repeated saves merge into
  the last; cap ~10 s → saves as the person with a warning, never dropped; tab/app close finishes the save;
  fail-first: attribution, merge, cap, interpreter crash/kill. Opus builder `p8-a1-save-hold`, off feat after the
  A1 push, at the first free slot (before import-from-link).

## Update ~22:30
- Pushed: A1 claims (679aba03d), port-gc (34f79beef; Rust 304 pass after linking binaries/ + resources/ from the main
  checkout — a fresh worktree has neither, so `cargo check` fails in build.rs before any test runs).
- Merged in lead-merge-main, NOT pushed: p8-v1-drop-desktop (8a5dda839) + the dgn undo-mode patch + rebuilt bundles
  (73748a289). Full studio + node suites running (bha7jy0i1). kg: 5 v2-p8-v1-drop-* decisions recorded.
- **Still owed for v1-drop-desktop:** a solo desktop run of the rewritten `format-update.e2e.ts`, plus the
  sync/security review → fold into the post-freeze security pair over the whole batch.
- Hub drafts: answered (b) fold, not hold (kg maude/v2-p8-hub-drafts-fold-not-hold).
- Spawned p8-a1-save-hold (Opus).
- Running: sweep-leftovers, fix-c2, held-conflict-status, selfhost-convert, hub-drafts, a1-save-hold.

## Michal via keeper ~22:45
- The Mac stays open and unlocked; continue until done. **No need to announce the chain4 screen window** — start it right at
  the freeze. Arc/Blender are off and system sleep is off, but the display may sleep: wrap 8.3 in `caffeinate -dimsu` for the
  whole run and watch the probe log (lock / cover / display sleep). If the screen locks: stop, tell the keeper, never retry
  on a locked screen (memory maude-webkit-locked-screen-invalid). Then the whole batch → freeze → chain4 → re-attests →
  .app without auto-update → PR.md / READY TO TRY → PR (draft). Weekly cap 85 % (~24 % now).
- Full studio suite on the v1-drop merge: 497/20635 fail, almost all 5 s timeouts; a sample of 3 failing files passes 36/36
  alone → suspected suite-level interference. Re-run with a full log: bxdom9lwj → scratchpad/full-suite-v1drop.log.

## Update ~00:00 (10-30)
- **CI on feat has been red all batch:** biome (8 errors, fixed in 851f8ae86) + Studio suite 12 fails on Linux (679aba03d).
  Those 12 must be fixed before the PR (Michal: nothing fails). Baseline full suite of feat on mini: b77sx9kup →
  scratchpad/mini-full-feat.txt.
- **v1-drop-desktop NOT pushed:** 18 real regressions (gesture tests expecting legacy undo records) + a full-suite
  cascade (~470 timeouts that vanish when the files run alone). Sent back to builder a7c70936. It stays merged only in
  lead-merge-main.
- **New integration worktree `lead-merge-2`** (off feat, without v1-drop): lint cherry-pick + fix-c2 + held-conflict +
  hub-drafts merged, bundle rebuilt, tsc/gens/biome/boot green (6e3f1537a). Sync/undo/rig on mini: b4f0l4uur →
  scratchpad/mini-merge2.txt. If green → ff feat + push, and rebase lead-merge-main onto it later.
- import-link: security pair done (blocker H1 decompression bomb; F1 drop, F2 agent egress; lows) → sent back to
  builder a07afcef. kg maude/v2-p8-import-link-shell-only-no-decompress. Michal's question about cells is with the keeper.
