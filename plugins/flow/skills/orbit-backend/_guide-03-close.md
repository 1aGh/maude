## Close: update and push (`/flow:done`, `/flow:bug-fix`)

Close-time only, and **warn-only**: nothing in this recipe can fail, block or roll back a close. The commit, the PR and the files on disk are primary; orbit receives a copy.

### A. Task update — `/flow:done` Step 6b, `/flow:bug-fix` Tracker sync

The command asks its usual question ("Mark ticket `ORB-<n>` as done in orbit and link this PR?"). On yes:

`orbit_update_task {key, status: <defaults.doneStatus or "done">, prUrl: <PR URL, when there is one>, comment: "Closed via /flow:<command> — <short sha> <commit subject>"}`

Only the fields given change. `status` may be a status name or a category (`todo` / `in_progress` / `done` / `canceled`); an ambiguous or unknown status comes back as an error naming the candidates — show it and move on, no retry loop. No key, and the user accepts the command's "create a ticket?" offer → run the Plan recipe's create step (list, title from the plan) first, then update.

### B. Artifact push — end of `/flow:done` Step 7 (after the retro is appended and the plan archived); `/flow:bug-fix` after the tracker sync

Push each file that exists, in this order, one `orbit_artifact_push` per file:

| File | `kind` | `title` |
| --- | --- | --- |
| the plan (its archived path) | `plan` | the plan's H1 without the `Feature: ` prefix |
| `.ai/logs/rca/issue-<KEY>.md` | `rca` | its H1 |
| `.ai/logs/execution-reports/<feature>.md` | `execution-report` | its H1 |
| `.ai/logs/code-reviews/<branch>.md` | `review` | its H1 |
| `.ai/logs/system-reviews/<feature>-review.md` | `retro` | its H1 |

Payload: `{repo, taskKey: <KEY, omitted when unset — a repo-level artifact>, kind, title, body: <file content>, command: "/flow:<command>"}`.

- **Only these paths.** Never push other files, `.env*`, config, raw logs or command output. A file that looks like it carries a secret (token, key, password, connection string) is skipped with a warning — never redacted and pushed.
- orbit versions an artifact by `kind` + title, so every push of the same title adds a version. Skip duplicates: `orbit_artifact_pull {repo, taskKey, kind}` first; the same title with a byte-identical body → skip it.
- A body over 400 000 characters → skip with a warning (orbit rejects it).

### C. Final state — last call

`orbit_state_report {repo, taskKey, phase: "done", detail: "PR <url> — <short sha>"}` (drop the PR part when there is none). Needs `KEY`; without one, skip.

### Report line

The command's `Tracker:` line reads `ORB-<n> @ orbit — status <done | unchanged>, <k> artifacts pushed`, followed by one `⚠ orbit: …` line per failed call.
