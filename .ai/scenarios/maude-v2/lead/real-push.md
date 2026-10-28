# V2-8.16 live check: real push lifecycle runs against iagh66/maude-git-smoke (#23)

Michal confirmed this directly in the lead's chat. 2026-10-27: "ano, jednou push na iagh66/maude-git-smoke".
2026-10-28 he widened it: "souhlasím s reálným pushem lifecycle, muzes jich pushovat kolik potrebujes".
The consent covers lifecycle runs against that throwaway repo only, as many as the check needs: a re-run after
a red, or a run 2x to show it is stable. It covers no other GitHub repo. If a run goes red, diagnose it, clean
the remote up, fix it (fail-first if it is a product bug), then re-run.
## What to build (nothing is committed to the product)
Work in your worktree, based on the current feat tip. Do NOT commit any GitHub-pointing conf or fixture. The
committed e2e lane must stay local-only (decision v2-p8-e2e-lifecycle-local-bare-remote). Keep the variant files
uncommitted under apps/desktop/e2e/ (e.g. `wdio.lifecycle-github.conf.ts`, `fixtures/make-lifecycle-github.ts`,
`scenarios/git-lifecycle-github.e2e.ts`), and delete them after the run. The evidence is the only thing that gets
committed.

- Fixture: full clone (no --depth) of https://github.com/iagh66/maude-git-smoke.git into a throwaway dir under
  $TMPDIR. Clean `main` (reset --hard origin/main), no local test branches. For the secondary, use the existing
  makeGitFixture(). The old version (5281d1e35^:apps/desktop/e2e/fixtures/make-lifecycle-fixture.ts) is a reference.
- Scenario: a copy of the CURRENT scenarios/git-lifecycle.e2e.ts (it matches today's UI). Swap the bare-repo
  `git --git-dir` reads and moves for GitHub ones:
  - read remote branches/refs with `git ls-remote`;
  - for the teammate branch smoke/from-remote and the out-of-band main commit, use a scratch clone that pushes
    over https.
- Credentials: no osxkeychain, no real-HOME git config, no system dialog.
  - Read the token ONCE: `gh auth token --user iagh66`.
  - Hand it to the app and to the spec's git through env only:
    - `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`;
    - first reset `credential.helper` to '';
    - then a `credential.https://github.com.helper` that prints `username=x-access-token` and
      `password=$MAUDE_SMOKE_TOKEN`.
  - Set `GIT_TERMINAL_PROMPT=0` and `GIT_ALLOW_PROTOCOL=https`.
  - Keep `MAUDE_USE_SYSTEM_GIT=1`.
  - Never write the token to a file, a log or the evidence. Grep the evidence for `gh[opsu]_` before committing.
- Everything else in the default lane's isolation stays exactly as it is: throwaway XDG/HOME, stub claude,
  NO_OPEN=1, MAUDE_NO_AUTOBUILD=1. Use the debug .app the V2-8.3 record already built; don't rebuild unless it's
  missing.

## Run
- Run until green twice in a row (each run is followed by the cleanup below). Before you start: `stat -f %m ~/.config/maude/prefs.json` must be the value stat prints at the start (1793064398 before the 2026-10-28 reboot — re-stat), and the same
  afterwards.
- Record `git ls-remote --heads` of the repo before and after the run.

## Cleanup (required, even if the run goes red)
- Delete every remote branch except `main` that this run created (smoke/*, the publish branch, etc.), using
  `git push --delete` with the same env-only credential.
- Verify `git ls-remote --heads` shows only `refs/heads/main`.
- Leave main's new commits as they are (the old lane did the same). Note them in the evidence.
- Delete the throwaway clone dirs and the uncommitted variant files.

## Evidence (commit only this)
`.ai/plans/notes/v2-evidence/V2-8.16-real-push/`:
- README.md: date, base commit, the consent quote, pass/fail per step, ls-remote before/after, and main's new
  commit SHAs;
- the wdio log (token-free);
- the run's screenshots.
Commit the evidence on your branch, then hand back with the branch name and the pass/fail summary.
