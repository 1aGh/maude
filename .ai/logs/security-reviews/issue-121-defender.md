# Security defender audit — issue #121

Date: 2026-09-11
Verdict: PASS — 0 blockers, 0 warnings.

## Evidence and scope

Reviewed the uncommitted issue #121 change against HEAD `55e228e60c10657e85c65f06a875d70efb3c984a`, including all three new sync modules and the new regression suite. Read the RCA and execution report, `security-auditor.md`, and the security-rules catalog. Configuration has no security override; default scope is classic, AI, supply-chain with a medium severity floor. This is the classic/AppSec defender pass; the companion attacker pass covers adversarial scenarios.

15 files scanned: `apps/studio/package.json`; `sync/{agent,codec,index,migrate-seed,projection,status,seed-repair,source-recovery,source-validation}.ts`; `test/{shared-doc-projection,sync-runtime,sync-status,sync-source-safety}.test.ts` under `apps/studio/`; and `pnpm-lock.yaml`. Excluded unrelated `.claude/settings.json`. Release notes and workflow reports are outside the code audit.

Ran diff-only secret-prefix and dangerous-sink scans, reviewed the filesystem/network matches in context, and walked A1–A12 against the changed paths. Read the existing atomic-write helper and installed diff implementation to verify the new code's security assumptions. No code was executed as part of source validation, no application server was started, and no production files were changed by this review.

## Blockers

None.

## Warnings

None.

## Dependency surface

`diff` is now an explicit runtime dependency pinned to `8.0.4`; the same version/resolution was already present in `pnpm-lock.yaml`. The lock change adds only the studio importer entry. Installed package metadata points to `https://github.com/kpdecker/jsdiff.git`, BSD-3-Clause, with no runtime dependencies or install lifecycle hooks. Its actual implementation consumes `maxEditLength` and `timeout` and returns undefined on budget exhaustion, which the caller rejects before mutating the Y.Text. Publisher age and registry-wide advisory status were not independently checked; this static review makes no whole-tree dependency-audit claim.

## Security boundary observations

- A8: `sourceError` invokes the parser only; it neither evaluates source nor resolves imports. Parse and duplicate diagnostics exposed through conflict status are generic and do not echo canvas contents or parser stacks.
- A9: New recovery filenames use a fixed typed slot and `path.extname(file)`, under the existing per-canvas history root. Snapshot fallback enumerates direct regular-file entries rather than consuming remote path strings. The changed runtime reuses the same canvas descriptor/history path boundary as existing migration snapshots; it adds no new request-to-filesystem identifier route.
- A2/A11: Rejected source is retained locally in bounded recovery files, not logs or network messages. Writes reuse `atomicWrite`'s random exclusive temporary file and owner-only mode. New warning messages contain canvas slug and a generic reason, not source bytes or credentials.
- Data integrity: Remote body validation precedes disk replacement, echo recording, and journal checkpoint. Unobserved local edits refuse replacement; failed recovery writes also refuse replacement. Both rejected candidates and local bytes are preserved when recovery is writable. Coupled CSS projection is skipped when the body is refused.
- Resource bounds: source and recovery writes retain the 4 MiB ceiling; rejected candidates use fixed recovery slots, separate from rolling valid snapshots. Source validation caches one candidate. The diff budget is a work bound checked by the dependency, not an exact wall-clock deadline for the entire operation.
- Limits: Parsing is a syntax/duplicate guard, not a semantic merge proof or a sandbox for a valid authored canvas. This change does not repair arbitrary existing hub history or guarantee preservation of every historically valid candidate. Those are documented scope limits, not new security bypasses found in this diff.

Summary: 0 blockers, 0 warnings, 6 notes. No remediation required by this defender pass.
