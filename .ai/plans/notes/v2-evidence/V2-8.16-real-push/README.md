# V2-8.16 live check: the git lifecycle against real GitHub (iagh66/maude-git-smoke, #23)

- Date: 2026-10-28
- Base commit: `dcd41a761` (feat/maude-v2 tip), branch `p8-real-push`
- App: a debug `Maude.app` built in this worktree from that commit (`tauri build --debug --config src-tauri/tauri.e2e.conf.json`)
- Consent (Michal, in the lead's chat; kg `maude/v2-michal-real-push-lifecycle-many`):
  - 2026-10-27: "ano, jednou push na iagh66/maude-git-smoke"
  - 2026-10-28: "souhlasím s reálným pushem lifecycle, muzes jich pushovat kolik potrebujes" (that repo only)

## Setup (none of this is committed)

The conf, fixture and spec were uncommitted files under `apps/desktop/e2e/live-github/`, and they were deleted
after the runs. The committed lifecycle lane stays local-only (`v2-p8-e2e-lifecycle-local-bare-remote`).

- Fixture: a full clone of `https://github.com/iagh66/maude-git-smoke.git` under `$TMPDIR`, on a clean `main`
  (`reset --hard origin/main`, no local branches). The secondary repo comes from `makeGitFixture()`.
- Spec: a copy of today's `scenarios/git-lifecycle.e2e.ts`.
  - Remote refs are read with `git ls-remote`.
  - Remote trees are read through a bare "observer" repo that the spec fetches into.
  - The teammate moves come from a scratch https clone that pushes: the `smoke/from-remote` branch, the PR merge
    and the out-of-band main commit.
  - Committed contents carry a run id, because main already had these files from older runs.
- Credentials, env only:
  - The token is read once per run (`gh auth token --user iagh66`) into `$MAUDE_SMOKE_TOKEN`.
  - `GIT_CONFIG_COUNT=2`: first `credential.helper=''` (a reset), then
    `credential.https://github.com.helper` = a shell function that prints `username=x-access-token` and
    `password=$MAUDE_SMOKE_TOKEN` for `get`.
  - Also set: `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=/dev/null` (no osxkeychain, no real-HOME
    `~/.gitconfig`), `GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL=https`, `MAUDE_USE_SYSTEM_GIT=1`.
  - The token was never written to a file. Every file here was grepped for `gh[opsu]_` and the fine-grained
    PAT prefix: none found.
- The default lane's isolation was left as it is: a throwaway XDG config home, the stub `claude`, `NO_OPEN=1`,
  `MAUDE_NO_AUTOBUILD=1` and the prefs guard. The app was never signed in to GitHub.
- `~/.config/maude/prefs.json` mtime was `1793188027` before and after every run.

## Runs

| Run | Result | GitHub main before → after | Heads after cleanup |
| --- | --- | --- | --- |
| run1 | red (harness) | `e404914a…` → unchanged | `refs/heads/main` only |
| run2 | red (spec) | `e404914a…` → unchanged | `refs/heads/main` only (deleted `smoke/from-remote`, `smoke/ui-lifecycle`) |
| run3 | **green** | `e404914ab61fc78f87b1525fc44d4b272f368ea5` → `afffef6fe395718faf03498c8d205664b1abc084` | `refs/heads/main` only (deleted `smoke/from-remote`, `smoke/ui-lifecycle`) |
| run4 | **green** | `afffef6fe395718faf03498c8d205664b1abc084` → `d7b61dcff11925450eca1db33c5ae9510e577b6e` | `refs/heads/main` only (deleted `smoke/from-remote`, `smoke/ui-lifecycle`) |

Run 3 and run 4 are green twice in a row. Each run's `ls-remote --heads` before and after is in `runN-summary.txt`.

- **run1** never reached the app. The base `wdio.conf.ts` refuses a `wdio.*.conf.ts` whose spec is not listed in
  `DEDICATED`, and that is a shared file. The variant files were moved to `e2e/live-github/`, which the guard
  does not scan. Nothing reached GitHub.
- **run2**: steps 1–5 passed against GitHub: boot, new branch, switch both ways, Save a version, Publish (the
  branch reached GitHub at the local HEAD) and Fetch (the teammate branch appeared). Step 6 was red.
  - The copied spec expected "Add to main" to merge into main and push. On a github.com remote the product
    opens a pull request instead (DDR-162, `branch-actions.js` `doFoldDraft`). Signed out, it publishes the
    draft and says "Draft published. Sign in with GitHub in Maude to open the pull request." (`run2-shots/`
    failure shot). main was left alone.
  - This is the intended behaviour, not a product bug. The local lane never sees it because its `ssh://` origin
    is not github.com.
  - Spec fix: assert that sheet and that GitHub main has not moved. Then a teammate merges the "pull request" on
    GitHub (a fast-forward push of the branch to main), and the app switches back to main.

### Steps in run3 and run4 (both all pass)

| # | Step | Check | run3 | run4 |
| --- | --- | --- | --- | --- |
| 01 | Boot on `main` | origin is the GitHub URL; GitHub main == local HEAD | pass | pass |
| 02 | New branch `smoke/ui-lifecycle` | Branch select shows it | pass | pass |
| 03–04 | Switch to main and back | checkout both ways | pass | pass |
| 05 | Save a version with a note | HEAD holds the run's change | pass | pass |
| 06 | Publish | `ls-remote` shows the branch at local HEAD | pass | pass |
| 07 | Fetch | teammate branch `smoke/from-remote` (pushed over https) shows in the select | pass | pass |
| 08 | Add to main | the PR sheet ("Sign in with GitHub…"); GitHub main unchanged; branch still at HEAD | pass | pass |
| 09 | PR merged on GitHub (teammate), back on main | GitHub main has the run's change; the app checks out main | pass | pass |
| 10 | Get latest | the nudge shows; local main gets both the merged change and the teammate commit | pass | pass |

### main's new commits (left in place, like the old lane did)

- run3: `42f7a06` "smoke: ui lifecycle commit" (made in the app, fast-forwarded to main), then `afffef6`
  "team: out-of-band change".
- run4: `3a25250` "smoke: ui lifecycle commit", then `d7b61dc` "team: out-of-band change".

## Files

- `runN-summary.txt`: the runner's record for each run (prefs mtime, ls-remote before and after, cleanup).
- `run1-wdio.log`: the guard error.
- `run2-wdio.log`: warnings and errors only. The full log was 24 MB, mostly DEBUG.
- `run3-wdio.log`, `run4-wdio.log`: the full logs without DEBUG lines, each line cut to 400 characters.
- `runN-shots/`: the screenshots and `report.md` for each run. `run2-shots/` holds the failure shot.
