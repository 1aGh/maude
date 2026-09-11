# Code review: main — issue #103

Date: 2026-09-11
Verdict: PASS
Baseline: 01bdcfdc
Ticket: https://github.com/1aGh/maude/issues/103
Decision: decision:maude/shared-sonner-notifications

## Result

Export errors are compact in notifications and fully expandable in history. Shell, export, What’s New, canvas and informational Undo notices share Sonner with automatic dismissal, stable export IDs and paused clocks for interaction, overlays, hidden groups and native Save. Runtime package, shipped bundle and canvas import map agree. Export history retains all jobs; selecting a toast focuses the corresponding row. Native saving remains explicit.

## Independent review

- Defender: PASS, zero unresolved blockers. Report: ../security-reviews/issue-103-defender.md.
- Attacker: PASS, zero unresolved blockers. Report: ../security-reviews/issue-103-attacker.md.
- Simplifier: no justified behavior-preserving patch; reviewed lifecycle, rendering, packaging and tests. Its informational Undo backlog suggestion was resolved with coalescing.
- Resolved medium finding: accepted canvas events could grow an unlimited queue and starve trusted notices. Both ingress paths now use two reusable canvas slots with at most five publications per one-second window. Burst/retention/drain regression and independent attacker rerun pass. Message data cannot supply shell IDs, callbacks or executable content.

## Validation

- Repo-wide Biome format check: 1335 files, PASS, no writes needed.
- Repo-wide Biome lint: 1342 files, PASS; 196 warnings and four infos, zero errors.
- Studio `bunx tsc --noEmit` and `scripts/check-tsc-coverage.sh`: PASS (281 tracked sources at check time; new TS sources included by tsconfig).
- Affected suite: 101 tests, zero failures, 1036 assertions across nine files. Includes notification timers, pauses, queue isolation, canvas boundary, export history/focus, runtime/import-map parity, canvas build/sandbox/CSP and release-feed tests.
- Release client rebuilt after remediation; all 26 shipped runtime bundle floors pass.
- Earlier targeted Chromium and WKWebView smoke passed. Native Save used mocked IPC; packaged desktop app and OS file dialog were not exercised.
- `--quick` defers full quality.tests, site build, scenario-runner, a11y-auditor and design-system-guard to full `/flow:validate`. Targeted release build above refreshes committed artifacts; it does not replace the deferred site build.

## Release and scope

Changeset: `.changeset/stacked-export-notifications.md`. Pending What’s New entry and generated site feed included. No ready-for-handoff canvas found. No separate implementation plan was active; acceptance comes from issue #103 and the approved conversation, recorded in the RCA. Unrelated `.claude/settings.json` change excluded.

User authorized commit and push on the current main branch. No PR or ticket update requested. The knowledge graph remains local-only.
