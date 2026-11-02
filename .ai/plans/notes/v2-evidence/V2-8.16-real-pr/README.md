# V2-8.16 live check, part 2: the signed-in GitHub pull-request path (iagh66/maude-git-smoke)

- Date: 2026-10-28
- Base: feat/maude-v2 `0ae3923f5`, branch `p8-real-pr`. Product change: `2768e291d` (below).
- App: a debug `Maude.app` (`tauri build --debug --config src-tauri/tauri.e2e.conf.json`, identifier
  `com.maude.app.e2e`). The Rust shell was built from `2768e291d`. The staged resources (`maude-server` sidecar,
  `apps/studio`) were the V2-8.3 build from `dcd41a761`, reused as the brief asked. Between `dcd41a761` and the
  base, nothing in `apps/studio/git/`, `github/` or `client/v2/history/` changed, and no non-test `src-tauri` file
  changed.
- Consent (Michal, in the lead's chat; kg `maude/v2-michal-smoke-repo-prs-no-ask`): 2026-10-28 "ano muzes delat a
  zavirat push a PRs, nemusis se me ptat". It covers pushes and PRs on that throwaway repo only.

## How the app was signed in (no keychain, no dialog)

The app had no seam that takes a real token. `e2e_github_sign_in_as` (debug builds only, and only with the
in-memory keychain `MAUDE_E2E_FAKE_KEYCHAIN`) stored a fake `e2e-token-<login>`.

- **Product change `2768e291d`** (`apps/desktop/src-tauri/src/oauth.rs`): when `MAUDE_E2E_GITHUB_TOKEN` is set and
  not blank, that seam stores its value instead of the fake token.
  - It is still debug-only and in-memory-keychain-only.
  - It goes through the same write path: `complete_github_sign_in` → keychain test store → loopback token
    bridge → the sidecar's `getGithubToken()`.
  - Fail-first: `oauth::tests::e2e_sign_in_token_takes_a_real_token_from_env_only_when_set` was red against the
    stub (`left: "e2e-token-x"`, `right: "live-1"`) and green with the fix. Both ran in `v2-test-lane.sh`.
- The conf read the token once with `gh auth token --user iagh66` into `$MAUDE_SMOKE_TOKEN`. It then set
  `MAUDE_E2E_GITHUB_TOKEN` from it, in env only.
- The spec calls `e2e_github_sign_in_as({login:'iagh66'})`, which answers profile `default`.
  `github_is_signed_in` then answers `true`.
- Git credentials are the same as in part 1 (`../V2-8.16-real-push/README.md`): an env-only
  `GIT_CONFIG_COUNT` helper, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`,
  `GIT_ALLOW_PROTOCOL=https` and `MAUDE_USE_SYSTEM_GIT=1`.
- The spec's GitHub API calls are `gh api` with `GH_TOKEN` set in that child's env only.
- The default lane's isolation was left as it is: throwaway XDG config home, stub `claude`, `NO_OPEN=1`,
  `MAUDE_NO_AUTOBUILD=1`.
- The variant conf, fixture and spec were uncommitted files under `apps/desktop/e2e/live-github/`, and they were
  deleted after the runs. The committed lane stays local-only (`v2-p8-e2e-lifecycle-local-bare-remote`).
- Every file here was grepped for `gh[opsu]_` and `github_pat_`: none found.
- `~/.config/maude/prefs.json` mtime was `1793188027` before and after both runs.

## Runs

| Run | Result | PR | GitHub main before → after | After cleanup |
| --- | --- | --- | --- | --- |
| run1 | **green** (1 passing, 28 s) | #1 opened by the app → merged | `d7b61dc…` → `d55d9889867bbfc24b796e6911b3596233570094` | 0 open PRs; heads = `refs/heads/main` only |
| run2 | **green** (1 passing) | #2 opened by the app → merged | `d55d988…` → `2634f7392b9024f4be061949bccb4c536205b2fd` | 0 open PRs; heads = `refs/heads/main` only |

Green twice in a row, with no red run. Cleanup ran after each run: the runner closed any open PR (there were
none) and deleted `smoke/ui-lifecycle` and `smoke/from-remote` with `git push --delete`. `ls-remote --heads`
before and after each run is in `runN-summary.txt`.

### Steps (both runs, all pass)

| # | Step | Check |
| --- | --- | --- |
| 01 | Boot on `main`, sign in | origin is the GitHub URL; GitHub main == local HEAD; `e2e_github_sign_in_as` → `default`; `github_is_signed_in` → true |
| 02–04 | New branch `smoke/ui-lifecycle`, switch to main and back | the Branch select follows |
| 05 | Save a version with a note | HEAD holds the run's change |
| 06 | Publish | `ls-remote` shows the branch at local HEAD |
| 07 | Fetch | the teammate branch `smoke/from-remote` shows |
| 08 | **Add to main · opens a pull request** | sheet title "Pull request opened #N"; body "Your branch “smoke/ui-lifecycle” is up as a pull request into main of iagh66/maude-git-smoke. Review and merge it on GitHub — that keeps your team’s review rules."; the PR URL; buttons Close / "Review on GitHub" (`git-model.js` words). The GitHub API reports the PR `open`, head `smoke/ui-lifecycle` at local HEAD, base `main`, title "Add draft “smoke/ui-lifecycle” to main", `html_url` == the URL the sheet shows. GitHub main has not moved. |
| 08b | Merge | The app has no merge or close action. "Review on GitHub" only opens the OS browser, and the run did not click it. Close dismisses the sheet. A reviewer merge then runs through `gh api -X PUT …/pulls/N/merge` (merge commit). The API then reports `closed`, `merged: true`, and GitHub main == the merge sha. |
| 09 | Back on main | the app checks out main |
| 10 | Get latest (after a teammate's out-of-band commit) | the nudge shows; local main gets the run's change and the teammate's file |
| 11 | The app reflects the merge | local HEAD has the PR's merge commit as an ancestor; the Branch select reads main |

### main's new commits (left in place, as in part 1)

- run1: `ef47fd6` "smoke: ui lifecycle commit", `dbd5548` "Merge pull request #1 from iagh66/smoke/ui-lifecycle",
  `d55d988` "team: out-of-band change".
- run2: `c1c17d0` "smoke: ui lifecycle commit", `535f0c8` "Merge pull request #2 from iagh66/smoke/ui-lifecycle",
  `2634f73` "team: out-of-band change".

## Notes

- The top bar reads "Local project" on a GitHub-remote project (see the step-08 shot). That chip describes the
  sync state, not git, so it is not a defect of this path.
- The app cannot show a PR's later state (open, merged or closed). After a merge on GitHub, the only signal in the
  app is Get latest bringing the merge commit. CONTRACT and `git-model.js` define no "PR merged" words, so the
  app never says it.

## Files

- `runN-summary.txt`: the runner's record for each run (prefs mtime, heads and open PRs before and after, cleanup).
- `runN-wdio.log`: the full wdio log without DEBUG lines, each line cut to 400 characters.
- `runN-shots/`: the screenshots and `report.md`.
