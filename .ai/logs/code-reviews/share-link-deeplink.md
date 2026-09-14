# Share-link closeout review — 2026-09-14

Verdict: **PASS — quick gate**. Plan: `.ai/plans/archive/feature-share-link-deeplink.md`.

## Result and scope

File addresses synchronize shell navigation and support Share from the topbar, File menu, palette and file tree. Links retain the selected file through browser sign-in. Desktop links open within the current project or ask before switching to a remembered project. Public identity comes from configuration and a link grants no additional access.

Reviewed source, tests, native command/capability registration, generated client artifacts, documentation and release notes. No dependency or lockfile changes. The worktree is detached; this closes locally without a push or PR.

## Independent reviews

- Defender: [PASS, zero security blockers/warnings](../security-reviews/share-link-defender.md).
- Attacker: [PASS, zero findings](../security-reviews/share-link-attacker.md).
- Simplifier: [no useful simplification patch](share-link-simplifier.md); the parent resolved its Unicode transport-length advisory and both security reviewers re-reviewed the final fix.

The native browser opener now permits exactly one validated file query at the compiled HTTPS cloud-zone front door, preserving its OS unsafe-byte restrictions. Unsupported encoded addresses show an explicit copy-link fallback. Hub return-to cookies now store a bounded canonical UTF-8 base64url identity, preserving the 512 UTF-16-unit filename limit without exceeding cookie limits. Added tests exercise these boundaries, forged paths, duplicate fields/cookies and malformed encodings.

## Final quick verification

| Gate | Result |
| --- | --- |
| `pnpm format` | PASS; 1347 files, no fixes |
| `pnpm lint` | PASS; 1354 files, no errors; 197 existing warnings and 4 informational diagnostics |
| Studio `bunx tsc --noEmit` | PASS |
| `bash scripts/check-tsc-coverage.sh` | PASS; all 284 tracked non-test studio sources checked |
| Studio share-link, cloud-endpoints and whats-new tests | 52 PASS, 0 fail, 846 assertions |
| Hub return-to, auth-hardening and studio-door tests | 26 PASS, 0 fail; Node 24.13.0 matching installed SQLite ABI |
| Rust `cargo test oauth::tests` | 11 PASS, 0 fail |
| Rust `cargo test project_resolve` | 2 PASS, 0 fail |
| Release client bundle with `MAUDE_SKIP_RUNTIME_BUILD=1` | Regenerated successfully; committed JS/CSS current |
| `git diff --check` | PASS |

The first hub invocation used a Node ABI incompatible with the existing SQLite binary. Re-running under the installed Node 24.13.0 runtime passed; no shared dependency rebuild was needed.

## Prior execution evidence and deferred checks

During execution: site build passed; browser boot/history, all share actions and preview sharing were exercised; scoped light/dark axe checks found zero violations; 73/73 canvas renders passed and each PNG was inspected. Native scenario passed 3/3 in 6.8 seconds, including a sentinel-seeded clipboard write, tree-row sharing, current-project navigation and foreign-project confirmation. Evidence: `.ai/device/scenario-runs/share-link/2026-09-14-final/report.md` and `.ai/logs/execution/feature-share-link-deeplink.md`.

That native binary/run predates the final opener/cookie fixes. The final changes are covered by the affected Rust/hub tests and two security re-reviews; native E2E was not rebuilt/repeated at closeout.

Per the explicit `--quick` request, the full test/build gate, cross-platform scenario, full a11y audit and design-system validation are deferred to `/flow:validate` before merge. iOS/Android native lanes are N/A: the studio has no native mobile app. Real deployed signed-out sign-in and signed-app OS protocol registration remain release smoke checks. Existing broader desktop E2E type errors reported during execution are outside the changed scenario/config.

## Release and tracking

Pending What's New entry and generated site feed included; minor package changeset included. All nine plan tasks complete, retrospective written, plan archived. Three graph DDRs record the root-query address contract, current-project/foreign-project behavior and hub-owned return cookie. The personal graph is local-only; no remote sync or tracker mutation is performed.
