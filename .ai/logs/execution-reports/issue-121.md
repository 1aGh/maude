# Implementation: #121 — preserve valid source during shared-doc sync

Date: 2026-09-11
RCA: .ai/logs/rca/issue-121.md
Ticket: https://github.com/1aGh/maude/issues/121
Status: implementation complete; `/flow:done --quick` verification passed. Full validation deferred by explicit user request; direct-main commit and issue closure authorized.

## Result

Shared-doc projection now checks source syntax, semantic binding errors, repeated function implementations and duplicate exports before writing TSX/JSX/TS/JS. Invalid local saves cannot enter the body lane. Rejected remote bodies cannot replace the local file or coupled CSS, and are not recorded as successful body checkpoints or echoes.

A shared seed-repair helper serves both legacy and shared-doc handlers. The original 10-second election/proven-repeat rule is retained; the shared migration now records its seed provenance. Exact-repeat collapse stays a pure delete. A cold-start repeat of a valid local TSX is still repairable; an invalid third version is quarantined instead of winning on timestamp.

Text replacement now uses bounded multi-hunk diffs (`diff` 8.0.4, already present transitively in the lockfile). Unchanged interior CRDT anchors survive the RCA's concurrent-edit example, and UTF-16 boundaries are protected. Pure insertion/deletion retains the cheap path. A diff exceeding 4,096 edits or its 50 ms compute budget refuses before mutation rather than falling back to the corrupting whole-interior splice.

Projection compares disk against the last observed body before replacing it, preserving edits awaiting their watcher. Recovery uses bounded `sync-recovery/last-valid`, `local`, and `incoming` slots under the canvas history directory, with the body's extension. These slots do not enter the rolling history queue, so corrupt-update traffic cannot evict the retained valid source. An overlapping explicit file import saves both sides before applying the user's source. Initial runtime projection waits for migration/reconciliation. Migration retains a valid pre-migration backup; if disk is already invalid, it searches retained and existing history for valid source instead of copying corruption over the recovery point.

The existing Sync panel notice surface reports refusals and recovery paths. Successful recovery clears the current source warning; conflict events remain in history. No frontend layout changes were needed.

## Verification

- Regression cases were added before the fix: all original eight failed against the old code, then passed.
- Source safety coverage includes both corruption shapes, 2/3-peer seeding with CSS, the concurrent valid-edit example, watcher races, malformed local saves, valid TypeScript overloads/interface merging, duplicate exports/bindings, failed recovery writes, valid historical fallback, CSS coupling, bounded diff failure, Unicode, synchronous peer updates during import, and preservation of invalid local drafts before accepting valid remote source.
- Actual shared-runtime wiring verifies healthy disk preservation, `_sync.json` conflict/notice data and recovery bytes.
- Related suites exercised: sync-source-safety, shared-doc-projection, shared-doc-migrate, sync-seed-duplication, sync-cold-seed-dedup, sync-codec, sync-seed-defers-to-hub, sync-runtime, shared-doc-cell-pairing, sync-status, sync-agent, sync-cold-start, cold-start-apply, sync-meta-codec, sync-annotations-cold-start.
- Latest targeted rerun: 100 tests passed across source-safety, projection and runtime. Additional related suites passed; the six-file legacy/cold-start/runtime batch passed 198 tests.
- Studio `bunx tsc --noEmit`: passed.
- Biome scoped to the 14 changed/new source, test and manifest files: passed, with one pre-existing non-null assertion warning in codec.ts's comments lane. `git diff --check`: passed.
- Three pre-existing runtime constructor doubles were arrows and threw before testing reconnect behavior. They now use constructible functions with an explicit `this` parameter, preventing Biome's arrow conversion from breaking them again. Their tests pass.
- The first root-level filter accidentally selected a staged desktop resource copy; subsequent runs used explicit paths from apps/studio. No bundled resource changes were made.
- Final close verification: repository format and lint passed (196 existing warnings, 4 infos); configured studio typecheck plus source coverage passed; 364 tests across all 16 affected/What's New suites passed with 1,634 assertions. Both security reviewers returned PASS, zero blockers/warnings. Studio Bun lock was regenerated and frozen-lock validation passed.
- Full repository tests, build, cross-platform, accessibility, design-system and live-hub verification remain deferred under the explicitly requested `--quick` close.

## Limits and recovery

This change does not reset the hub or discard persisted CRDT history. A coordinated single-document reset/generation protocol remains a separate feature. Existing invalid hub state is retained for diagnosis and blocked from overwriting valid local source; a deliberate valid file edit can propagate a repair, subject to the merge budget and any concurrent stale-peer changes.

Multi-hunk text merging plus source validation cannot prove semantic correctness of every concurrent edit. Valid-but-conflicting authored edits require reviewing the preserved versions. Large replacement edits can be refused when they exceed the merge budget. The recovery slots are bounded current copies, not an unbounded archive of every rejected update. No live user canvas or hub document was modified.

## Retro

- Adding failing examples before changing the sync path exposed gaps despite the old suite being green.
- Validate actual runtime notice/recovery wiring in addition to testing helpers; both paths mattered for this regression.
- Keep both package-manager locks in view: studio CI installs independently with Bun's frozen lock.
- Run Bun tests with explicit paths from studio to avoid accidentally selecting bundled desktop copies.
- Treat syntax integrity and recovery as bounded guarantees; semantic merges and coordinated hub reset remain distinct problems.
