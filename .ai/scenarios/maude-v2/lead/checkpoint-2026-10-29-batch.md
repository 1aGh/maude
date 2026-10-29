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
