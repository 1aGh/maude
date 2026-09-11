# Code Review: main — issue #121

Date: 2026-09-11
Verdict: PASS
Baseline: 55e228e60c10657e85c65f06a875d70efb3c984a
Ticket: https://github.com/1aGh/maude/issues/121

## Summary

Shared-document sync now preserves local source when incoming TSX/JSX/TS/JS is malformed, duplicates declarations, or races an unobserved local edit. Shared seed repair handles exact repetitions, bounded multi-hunk diffs preserve unchanged anchors, and bounded recovery copies survive rejected-update floods. Migration retains valid backups. The existing Sync panel shows held updates and clears the warning after recovery.

## Files reviewed

- `apps/studio/sync/{projection,migrate-seed,index,status}.ts`: validate and preserve source at disk boundaries; report refusals and recovery.
- `apps/studio/sync/{seed-repair,source-recovery,source-validation}.ts`: shared seed provenance, recovery slots and syntax/declaration validation.
- `apps/studio/sync/{agent,codec}.ts`: reuse seed repair and preserve unchanged text anchors with a bounded diff.
- `apps/studio/test/{sync-source-safety,sync-runtime,sync-status,shared-doc-projection}.test.ts`: regression coverage and constructible provider doubles.
- `apps/studio/package.json`, `apps/studio/bun.lock`, `pnpm-lock.yaml`: pin diff 8.0.4 in both installation paths.
- Changeset and Studio/site What's New feeds: pending release notes.

## Findings

No unresolved critical or important findings. Independent defender and attacker audits both returned PASS with zero blockers and zero warnings. The simplifier found a missing Bun lock entry, which was regenerated before final verification.

Security reports: `../security-reviews/issue-121-defender.md` and `../security-reviews/issue-121-attacker.md`.

## Simplifier outcome

No patch recommended: explicit validation, preservation, and checkpoint boundaries are clearer kept separate. Original production code remained unchanged throughout the parallel review. The final checks therefore validate the same code the auditors read.

## Verification

- `pnpm format`: PASS, no fixes.
- `pnpm lint`: PASS, 196 existing warnings and 4 informational diagnostics; no errors.
- Configured typecheck (`bunx tsc --noEmit` plus `scripts/check-tsc-coverage.sh`): PASS.
- Affected suites plus What's New: 364 tests passed, 0 failed, 1,634 assertions across 16 files.
- Studio frozen Bun lock validation: PASS.
- `git diff --check`: PASS. Studio committed bundles unchanged after tests.

## Quick-mode limits and authorization

User explicitly requested `/flow:done --quick`, direct commit to main and closure of #121. Build, full repository tests, live cross-platform scenario, accessibility audit, and design-system check were skipped. No release or deployment is part of this close. Source parsing cannot prove semantic correctness of arbitrary concurrent edits; coordinated hub document reset remains separate work. No live user canvas or hub state was modified.

Decision: `maude/shared-source-writes-preserve-valid-files` in the local knowledge graph.
