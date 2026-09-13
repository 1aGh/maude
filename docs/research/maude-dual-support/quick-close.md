# Native Codex plugins — quick close verification

Date: 2026-09-13. User requested `flow:done --quick` after reviewing the completed
implementation. This records the existing implementation; no retrospective
`flow:plan` or planning approval is implied. No task-specific plan existed, so
there is no plan to archive. The older environment-projection plan stays separate.

## Accepted implementation scope

- [x] Native marketplace and both plugin manifests are present and valid.
- [x] All 55 command entries route to shared procedures; 30 shared skills and all
  31 role instructions remain available. Prior isolated native discovery: 85/85.
- [x] Fourteen split shared-skill bodies reconstruct exactly by SHA-256 when the
  recorded boundary newlines are restored. Trailing blank lines were normalized
  in the individual reference files for Git's whitespace check.
- [x] Host conventions, explicit kgai checkpoints and required dependencies are
  documented; no new adapter runtime or guessed model mapping was introduced.
- [x] Launcher preserves verified source-owned native packages; healthy Studio
  reuse does not depend on permission to signal the process.
- [x] Installation/Studio docs and all 55 command references cover both hosts.
- [x] Implementation decisions are captured in the existing personal local graph.
- [x] Quick static gates, affected tests and independent security review pass for
  the intended commit scope, with the workspace exclusion described below.

## Gate evidence

| Gate | Result |
| --- | --- |
| Repository formatter, read-only equivalent | 1,341 supported files pass when checked over tracked files plus this change's additions. |
| Repository Biome check | 1,348 supported files pass over the same intended scope. |
| Shared workspace caveat | Literal whole-workspace format/lint also picked up unrelated untracked `docs/audits/2026-09-13-hub-sync/reproduce.ts`, which has formatting/import-order errors. It was not modified or included in this change. Initial formatting issues in this change's JSON were corrected. |
| Studio TypeScript | `bunx tsc --noEmit` passes; coverage script confirms all 284 tracked non-test Studio sources are checked. |
| Affected CLI tests | 33/33 pass: launcher/materialization, CLI options, plugin namespace/helper reachability and server reuse. |
| What's New | 12/12 feed tests pass; site mirror regenerated. |
| Split-command regression | Three exact grep cases pass after restoring the DS-drift regex. |
| Native plugin validator | Both plugins pass after final manifest formatting. |
| Shell/version checks | Syntax, manifest version parity and Bun pin pass; version remains 1.2.0. |
| Docs production build | Previously passed (282 pages). Not repeated as a quick gate. |

Quick mode defers the full build, cross-platform scenario, a11y and design-system
audits. It also skips the optional project-instruction debrief. The broader
repository test suite was not represented as passing by these affected tests.

## Independent code review

Verdict: **PASS after one correction**. Native subagents read the same scoped
change independently; role prompts were behavioral restrictions, not a claim of
separate enforced tool permissions.

- Defender: 0 security blockers, 0 warnings. Verified that native materialization
  still performs hash and symlink checks before its new early return.
- Attacker: 0 security blockers, 0 warnings; sequential defender-chain pass found
  no viable exploit chain. HTTP identity is a consistency check, not authentication
  against another process controlled by the same local user.
- Simplifier: no broad refactor warranted. Found one functional regression:
  Markdown link rebasing had modified a regex inside the moved edit-command code
  fence. Restored `[ -](drift|color...)`; `DS-drift` and `design-system-drift`
  match again, while unrelated feedback remains outside that fast path. Reviewed
  the remaining original new/edit rebasing candidates for the same issue.
- Parent recheck: patch inspected, exact regression cases pass, affected tests and
  final formatting checks run after review.

Detailed local reports:

- `.ai/logs/security-reviews/native-codex-20260913-defender.md`
- `.ai/logs/security-reviews/native-codex-20260913-attacker.md`
- `.ai/logs/code-reviews/native-codex-20260913.md`

These ignored reports are recorded through kgai; this committed document keeps
the actionable verdict and evidence available with the code.

## Delivery and remaining verification

A minor changeset and a pending What's New entry accompany this change. No
version bump or release is performed by this close. No ready-for-handoff canvas
was found. No linked tracker ticket exists for this task.

Full visual Studio acceptance remains open: a browser must launch, a real canvas
selection must reach Codex, and the edit/snapshot/screenshot/critic loop must be
observed. See [the runtime probe](studio-verification.md). Native discovery and
the static reviews are not a certification of every workflow on every model.
Studio ACP remains [a separate follow-up](acp-follow-up.md). Publication and docs
deployment are separate from local implementation completion.

## Retro

- Shared procedures and staged references kept both hosts on one workflow body.
- Native discovery checks established installation compatibility but could not
  substitute for a real visual workflow test.
- The review caught code-fence corruption that aggregate preservation claims for
  separately rebased commands did not rule out; future moves must protect code
  fences before rewriting Markdown links.
- Implementation began without a dedicated plan. Future work should record the
  agreed scope and acceptance boundary before editing, especially when the user
  narrows a research task into a small distribution change.
- Keep host/environment blockers explicit and preserve other sessions' files
  when closing changes in a shared working tree.
