# RCA: Ticket 121 — Shared-doc TSX corruption: doubling and interleaved/truncated source

Date: 2026-09-11
Ticket: https://github.com/1aGh/maude/issues/121 (open, no comments at investigation)
Related: https://github.com/1aGh/maude/issues/114 and its closure comment
Code examined: 55e228e6; reported release 1.2.0 (c9b39d55).
Scope: investigation and proposed fix only; no application changes or live hub mutations.

## Summary

Two reproducible defects remain in shared-doc sync: concurrent initial seeds can double the body because the live seed repair is wired only to the legacy agent, and concurrent full-file edits can merge valid TSX into invalid source because the codec expresses each edit as one prefix/suffix splice in an opaque Y.Text. The shared projector then persists either result without syntax/duplicate-declaration validation or a live disk-divergence check. Migration backs up whatever bytes happen to be on disk, overwriting its fixed backup location. These mechanisms explain both reported shapes and the recovery failure, but the exact September 10 event sequence is not proven: the incident's source files, CRDT binaries, hub updates and writer logs were not supplied or inspected.

The relevant projection, codec, migration and cold-start files are unchanged between the 1.2.0 release commit and examined HEAD. This is an incomplete earlier fix, not evidence of those fixes being reverted after release.

## Root Cause

### 1. Shape B: shared-doc misses the legacy live seed repair

`apps/studio/sync/index.ts:2911-2953` selects `createDocProjection` for shared-doc rooms and `createCanvasSyncAgent` otherwise. Only the latter's `onDocUpdate` invokes `maybeRepairSeedDuplication` (`agent.ts:202-212`, implementation at 248). `projection.ts:145-165` just schedules a flush for remote changes. It has no seed baseline, ownership election or live duplication repair.

`migrate-seed.ts:157-205` imports local source into an empty document. `hubHasState` prevents seeding when the hub listing already proves the document exists; it is not an atomic claim for a genuinely new document. Two replicas can both adopt before learning the other's inserts. Yjs retains both sets of inserted items. The shared projector writes the doubled result on the subsequent remote update, without another cold-start decision.

Cold-start recovery is narrower than detecting a self-doubled document. `cold-start.ts:72-79,147-162` tests whether the document equals the CURRENT LOCAL body repeated. Thus hub `X + X` with local `Y` does not enter `recover-seed-dup`. This directly matters to the report: the 87,383-byte half was neither the 84,730-byte repair nor the 100,398-byte earlier corrupt file. The result instead follows ordinary divergence/fast-forward logic, depending on journal and timestamps. Once both disk and hub contain the doubled body, the equality row is a no-op as well.

This proves a still-open route to shape B, not that the September 10 event was definitely a fresh seed collision. Existing corrupt CRDT history or another peer's write could have supplied that third version.

### 2. Shape A: text convergence does not preserve TSX syntax

`codec.ts:118-146` finds one common prefix and suffix, deletes the entire changed interior and inserts the replacement interior. This is neither a syntax-aware merge nor a multi-hunk edit. It can remove unchanged context between two edits. A concurrent insertion anchored inside that removed context survives the CRDT merge at a position that makes the resulting source invalid.

Deterministic example, using the actual codec and two replicas sharing the same initial Yjs history:

```tsx
// Base — valid
export const X = <div a="old" b="old"/>;
// Peer A — valid
export const X = <div a="new" b="new"/>;
// Peer B — valid
export const X = <div a="old" title="added" b="old"/>;
// Converged on BOTH peers — invalid
export const X = <div a="title="added" new" b="new"/>;
```

Bun.Transpiler accepts the three inputs and rejects the merged result. This establishes that malformed local input is not required. Large edits spanning several sections can likewise duplicate inserted regions while dropping context, consistent with the reported repeated blocks and broken attributes; the exact three-copy incident is not reproduced byte-for-byte.

Non-atomic external writes remain another possible input to this failure: the body's `applyFromFs` path (`projection.ts:322-338`) imports arbitrary text without parsing, immediately clearing the circuit-breaker strike state. The advertised parse quarantine applies to JSON sidecars, not TSX bodies. No incident evidence selects this alternative over concurrent valid edits.

### 3. Corruption becomes disk state without a validity or freshness gate

`projection.ts:219-233` checks only non-emptiness and the byte cap before recording an echo, writing the body and checkpointing its hash. There is no TSX validation, duplicate binding/export check, snapshot or conflict callback. `reconcile` uses this same writer. Atomic rename in `atomic-write.ts:48-66` faithfully replaces the file; it does not append content and does not prevent writing already-corrupt text.

The live writer also does not check whether disk has changed since its last observed/imported body. A pending remote projection can overwrite an external repair before that repair is imported. This is a code-supported race, not established causation for the reporter's hand repair. Even after a repair imports, subsequent concurrent updates can merge into it and be projected again. An echo hash avoids feedback from our own writes; it is not conflict resolution or a validity guarantee. The journal records traversed bytes, not a last-known-good version.

### 4. Backup is a current-file copy, not a known-good recovery point

`migrate-seed.ts:214-216,384-405` copies current local files to a fixed `pre-shared-doc-migration` directory using `copyFileSync`. It neither parses source nor consults valid history, and overwrites the earlier same-name copy on later calls. If corruption predates migration, the backup necessarily contains it. The supplied timeline (08:35 corrupt file, 08:37 identical backup) is fully consistent with this behavior; migration is not proven to have created the 08:35 corruption.

Projection starts before the handshake's reconciliation for locally discovered canvases (`index.ts:2770-2771,2839-2857,2926`). A sufficiently delayed handshake/reconcile also exposes a pre-backup projection window, although the incident timeline alone does not establish that ordering.

### Previous fix and coverage gap

The #114 closure identifies concurrent CRDT seeding, not append-on-write. Commits `dd73e5a36` and `e2924949a`, incorporated in later history including `de636b23`, extended per-lane cold-start recovery and made CSS collapse a pure deletion. They did not wire the legacy agent's live repair into the shared projector or solve simultaneous same-body edits.

`sync-cold-seed-dedup.test.ts` covers the legacy agent; `sync-seed-duplication.test.ts` exercises codecs and cold-start decisions, including explicit recovery. They do not prove automatic live repair through shared projection. `shared-doc-projection.test.ts:14-19` explicitly excludes same-body concurrency, while its concurrent edit test covers independent body/comment types.

## Evidence and Reproduction

Run from repository root:

```sh
bun .ai/logs/rca/issue-121-repro.ts
```

This local-only script uses current production modules and temporary files; it does not contact a hub. Observed output:

```text
concurrent shared seeds: {"docDoubled":true,"diskDoubled":true}
third version doubled decision: conflict
invalid remote replaces healthy disk: true
migration backs up invalid bytes: true
concurrent valid edits: {"inputsValid":true,"converged":true,"mergedValid":false,...}
```

Existing focused suites: **58 pass, 0 fail, 176 assertions** on Bun 1.3.3:

```sh
cd apps/studio
bun test test/shared-doc-projection.test.ts test/shared-doc-migrate.test.ts test/sync-seed-duplication.test.ts test/sync-cold-seed-dedup.test.ts
```

Competing explanations: append-on-write is excluded for the examined projector; duplicate delivery of the SAME Yjs update is not the independent-insert mechanism reproduced here. A malformed external edit remains possible but is unnecessary to reproduce shape A. To attribute the real incident, preserve the affected `_state/<slug>.ydoc.bin`, hub state/update history, healthy/corrupt snapshots and peer/write timestamps, then compare insertion client IDs and overlapping deleted/inserted ranges. File sizes alone cannot establish the writer or ordering; the hub's reported byte count is not proof of a particular materialized body without checking its metric.

## Impact

High severity: silent corruption of user-authored source in shared-doc projects, making canvases unbuildable and allowing healthy local repairs to be overwritten. TSX bodies are enabled by default under DDR-079; the shared-doc path is DDR-064. CSS text lanes share seeding/merge risks, although valid repetition can be intentional CSS. Sync connectivity/convergence can remain healthy while materialized source is unusable.

Immediate containment follows the issue's workaround: stop syncing processes, preserve all evidence, restore a known-good file and set that canvas's existing meta sidecar `syncable` to false before reopening. This sacrifices sync for that canvas. Do not blindly halve shape A or assume deleting a local cache resets the hub. Recovery must account for authoritative hub state and stale peers.

## Proposed Fix

1. **Protect materialization first.** Add a shared body-validation boundary used by both cold-start and live projection for TSX: syntax plus duplicate top-level binding/export diagnostics, without executing canvas code. Reuse the project's parser tooling, but do not assume parser success alone detects duplicate declarations. Preserve healthy disk and record a visible conflict with quarantined candidate bytes when validation fails. Validate before recording echo/journal success. Keep format-specific policies: do not parse HTML/CSS as TSX or blindly deduplicate valid repeated CSS.
2. **Preserve external edits and recovery evidence.** Compare disk against the last acknowledged projection/import baseline before replacing it; an unobserved local edit must enter a conflict path with both versions preserved. Snapshot before initial projection. Preserve immutable last-known-good snapshots independently from raw pre-migration copies; corrupt bytes are useful forensic evidence but must not replace the good recovery point. Candidate rejection must not create a watcher retry loop.
3. **Close the shared live-seed gap.** Extract tested seed collision handling from `agent.ts` into a shared primitive, invoked by the shared-doc path before materialization. Carry actual seed provenance/baseline and ensure repairs are convergent pure deletes. For nonidentical concurrent seeds, preserve both and flag conflict rather than choosing by substring. Consider a hub-authoritative initialization claim for robust prevention; `hubHasState` listing alone is insufficient coordination. Already doubled third versions need explicit diagnosed recovery, not the current local-repeat predicate.
4. **Handle concurrent whole-file edits explicitly.** Replace the single-splice approximation with base-aware multi-hunk edits to preserve unchanged anchors, and route overlapping/divergent source changes to conflict resolution. Multi-hunk diff reduces this specific failure but cannot guarantee semantic or syntactic correctness for all concurrent edits; retain post-merge validation. A whole-value revision/CAS protocol is an alternative requiring a separate architectural decision, not an automatic switch to last-writer-wins.
5. **Provide coordinated single-document recovery.** Preserve corrupt history, pause competing writers and install a selected valid source through a documented hub/peer reset or revision protocol. Prevent old replicas from replaying corrupt history after reset. Recovery must handle body and coupled CSS while preserving unrelated comments/annotations.

Likely files: `sync/projection.ts`, `sync/migrate-seed.ts`, `sync/index.ts`, `sync/agent.ts`, `sync/codec.ts`, `sync/cold-start.ts`, shared validation/history/status helpers, and hub document administration for the reset feature. DDR-102's journal/conflict principles should extend to the live write boundary.

## Testing Requirements

- Real shared-doc runtime wiring: two/three peers seed an empty document, exchange delayed updates, project automatically and remain single-copy on disk; include CSS and late joins.
- Concurrent valid same-body TSX edits from the reproduction, both delivery orders, plus disjoint and overlapping multi-section edits; convergence must never silently replace healthy disk with invalid source.
- Parse failure AND duplicate top-level declaration/export candidates; parser-only acceptance must not pass the duplicate case.
- Doubled third version versus a different local repair; preserve both with explicit recovery, never silently fast-forward corruption.
- External disk repair interleaved with pending remote flush, watcher import and reconnect; unobserved edits survive or become recoverable conflicts.
- Corrupt state before migration and delayed handshake; last-known-good snapshot survives repeated boots and backup failures.
- Quarantine/status/echo/journal behavior, legitimate repeated CSS, valid source changes and independent comments/annotations remain correct.
- Hub reset/reconnect with stale peer state if that recovery feature is included.

## Complexity

High for complete prevention and coordinated recovery. A focused validation/freshness barrier and shared live-seed repair can be staged first, with explicit limitations: they contain corruption but do not by themselves solve all concurrent source editing or clean existing hub history.
