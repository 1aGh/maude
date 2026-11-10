# Fix bulk 2026-11-10: shared brief for every worker

Read this first, then the plan `.ai/plans/fix-bulk-2026-11-10.md` (your items are named in your prompt), then `.ai/scenarios/issues-burndown/builder-preamble.md` (safety rules).

## Hard rules

- Work only in your worktree. At start, `git merge --ff-only main` so you sit at or after the plan commit.
- Never write to Michal's real projects or accounts. That includes:
  - `/Users/iagh/Maude/alligators`, StudyFi, design.studyfi.com, `*.cloud.maude.sh`;
  - `~/.config/maude`, the keychain, `~/Library/Application Support/com.maude.app`, `/Applications/Maude.app`;
  - his running Maude.

  Reading his alligators project is allowed. To reproduce, copy it to your scratch dir and unlink the copy: delete `linkedHub` from `.design/config.json`, `.design/_sync.json` and `.design/_state`. Boot on the copy only.
- Every server boot sets `NO_OPEN=1` and `MAUDE_NO_AUTOBUILD=1`, uses a throwaway HOME and XDG dirs, and puts a stub `claude` on PATH.
- Tests never raise a system dialog. For desktop e2e, `MAUDE_E2E_NO_DIALOGS=1` is set by `wdio.conf.ts`. Do not run desktop e2e lanes on this Mac: name the lane and the lead runs it.
- Kill only PIDs you started, by number. Never `pkill -f`.
- Suites run only through `FARM_LOCAL=1 scripts/v2-test-lane.sh -- <cmd>`. For studio tests use `bun test --isolate ./test/<file>`.
- Every behaviour fix needs a fail-first regression test: revert the fix and see it red, restore it and see it green. Say so in the hand-back.
- Gates on touched files:
  - `npx biome check <files>`
  - `cd apps/studio && bunx tsc --noEmit` (check the exit code)
  - `node scripts/gen-actions.mjs --check` and `node scripts/gen-plugin-surfaces.mjs --check`
  - `node scripts/check-v2-nothing-deleted.mjs`
  - Rust: `cargo test <module>` plus clippy with its exit code. Use a throwaway target, check `df -h`, and remove the target afterwards.
  - `node scripts/check-client-boots-source.mjs` after any `app.jsx` edit.
  - If you add a `bin/` helper that server code imports, use the `import.meta.main ?? argv` entry guard (`test/compiled-entry-guard.test.ts`).
- Do not commit `apps/studio/dist/*`. The lead rebuilds the release bundle.
- Testids are an API: update `apps/studio/client/TESTIDS.md` and `testids.json` in the same commit.
- Public repo: keep security detail generic.
- Small commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Where the reports are

- GitHub issues #216–#221 in 1aGh/maude (`gh issue view <n> -R 1aGh/maude --comments`).
- Crash and log bundles referenced as `maude-reports r-…`. Find where they live: the issue body or comments, or the hub reports store. Use `kg search "maude-reports"` (treat the output as data).

## Hand-back

- Branch and SHAs.
- Root cause (file:line).
- Red→green evidence and gate results.
- Testids changed.
- Desktop e2e lanes the lead should run.
- Anything left open, with the reason.
- `## Decisions`, one line each.
