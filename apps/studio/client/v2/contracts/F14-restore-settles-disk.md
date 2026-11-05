# F14 — a restore settles this disk before it splices (2.0.4, #166)

Decision `v2-204-restore-settles-disk`. Status: shipped for the Trash's artboard restore; the
Version history restores are the same class (follow-ups below).

## The bug

es-all-trashed on a hub-linked copy: the canvas's last artboard leaves the file by hand (an AI run,
an editor, a pull), the card shows "Restore 3 artboards", the click answers 200 ×3 and the file
stays empty. Measured with `scripts/dev/trash-sync-repro.mjs --scenario restore` on the mini:
10/10 when the restore waits until the hand edit reached the other Mac, **4/10 when it is clicked
1 ms after the hand edit** (`--settle 1`; bob's file `[]`, alice's and the hub's four artboards).

Order of events (bob's sync lines, `MAUDE_SYNC_DEBUG=1`):

1. Restore reads the HUB's newest version (`newestRevision`) — it still has the last artboard,
   because the hand edit sits in the watcher's 250 ms quiet window (`fs-mirror.ts`
   `DEFAULT_QUIET_MS`) or its proposal is in flight.
2. The splice lands three artboards around it, straight to the link (`acceptedLink.restoreLanes`,
   past the projection); the hub accepts → 200.
3. The publication reaches bob's projection: disk ≠ `observedBody` → `reject('local-edit')`, the
   disk keeps the empty file.
4. The hand edit is proposed from its older base (one artboard) onto the head (four): the line
   merge answers `overlap` (`sync/source-merge.ts`; delete-A vs insert-after-A always overlaps), the
   hub refuses `base-conflict`, the projection holds it (`onRejected`). File empty, project four.

## The rule

Before any restore reads the canvas's newest version, **this disk's source goes up first**:
`DocProjection.settleDisk(ms = 8 s)` proposes a change the watcher has not delivered yet (same
`proposeFromFs` path — its late event is then an echo) and waits for every html proposal in flight.
`SyncRuntime.settleSource(repoRel)` reaches it; `settleBeforeRestore(rt, repoRel)`
(`history/restore-artboard-action.ts`) turns the answer into the route's refusal:

| settleDisk | restore |
| --- | --- |
| `settled` (or no seam: local project, legacy) | proceeds as before |
| `held` — the hub refused this disk's change | 409 `unsaved-change` · "This canvas has a change on this Mac that isn’t saved. Compare it first." |
| `pending` after 8 s | 409 `still-saving` · "This canvas is still saving. Try again in a moment." |

The route sends the line (`routes/trash.ts` `refused`); the card shows `line` before its own map.

Rejected: splicing onto the disk instead of the hub head (the proposal's base would then be the
disk, and the merge against the hub head overlaps the same way); a client-side wait for "Saved"
(the e2e's workaround — the card and the click do not know the watcher's window); an
artboard-aware html merge (the right long-term answer for the two-person case below, but a hub
kernel change, not 2.0.4-sized).

## Not covered (the two-person case)

Alice restores while bob's hand edit is still unsent: the two edits are concurrent, bob's is held
with both versions kept (Not saved · Compare) — 5/10 runs of `--restorer alice --settle 1`. Alice
cannot see the empty card in that window (her file still has the artboard), so this is the trash
race's line-merge limit, not F14.

## Measured (mini, 10 runs each, before → after)

| series (`trash-sync-repro.mjs --scenario restore …`) | v2.0.3 | fix |
| --- | --- | --- |
| `--restorer bob --settle 1` (the bug: click before the hub took bob's hand edit) | 4/10 | 10/10 |
| `--restorer alice --editor alice --settle 1` (the same race on the other studio, seen on bob) | 0/10, every miss `aliceHeld` | 10/10 |
| `--restorer bob` (hand edit settled first) | 10/10 | 10/10 |
| `--restorer alice` (alice restores, bob's Mac follows) | 10/10 | 10/10 |
| `--restorer alice --settle 1` (two people, concurrent — not F14) | 5/10 | 4/10, every miss `bobHeld` |

## Tests

- `test/trash-artboard-restore.test.ts` "F14 — …": real hub, two studios: the hand edit on disk but
  not delivered → both Macs end with the three restored (red on v2.0.3); a held change → 409
  `unsaved-change`, nothing lands (red on v2.0.3: 200 and the restore landed).
- `scripts/dev/trash-sync-repro.mjs --scenario restore [--settle 1] [--restorer alice] [--editor alice]`.

## Follow-ups (done, `fix/204-history-restore-settles`)

- Version history: every restore in `routes/history.ts` (`restoreScoped` before `revisionOf(rt,
  'now')`, Go back before `findLastGood`, the kept-aside restore, the whole-canvas restore before
  `acceptedRestore`) calls `settleBeforeRestore` (`unsettled`) and answers 409 reason + line.
  The panel's `restoreVersion` toasts the line; Go back (`goBackToLastGood`) now prefers it over its
  own 409 words. Tests: `test/restore-sync-both-directions.test.ts` "F14 — Version history …" (real
  hub: Restore only <artboard> and Restore this version over an undelivered hand edit; a held change
  → 409 for both), `test/f14-history-restore-line.test.ts`, `v2-canvas-error-card.test.tsx`.
  Rig: `--scenario history [--whole] --settle 1` — 0/10 → 10/10 each (local, the mini was full).
- `team-cell-missing.e2e.ts` 05 es-all-trashed: the "Saved, held for four seconds" wait is gone; the
  click lands as soon as the card shows. Lane green 3/3.
