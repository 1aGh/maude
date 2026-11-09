## Close: update and push (`/flow:done`, `/flow:bug-fix`)

Close-time only, and **warn-only**: nothing in this recipe can fail, block or roll back a close. The commit, the PR and the files on disk are primary; orbit receives a copy.

### A. Task update — `/flow:done` Step 6b, `/flow:bug-fix` Tracker sync

The command asks its usual question ("Mark ticket `ORB-<n>` as done in orbit and link this PR?"). On yes:

`orbit_update_task {key, status: <defaults.doneStatus or "done">, prUrl: <PR URL, when there is one>, comment: "Closed via /flow:<command> — <short sha> <commit subject>"}`

**Never past `doneStatus`.** The default target is `tracker.defaults.doneStatus`; flow never moves a task further than that status (anything after it belongs to people or other automation), and a task that already shows a done-category status keeps it — omit `status` then. Only the fields given change. `status` may be a status name or a category (`todo` / `in_progress` / `done` / `canceled`); an ambiguous or unknown status comes back as an error naming the candidates — show it and move on, no retry loop. No key, and the user accepts the command's "create a ticket?" offer → run the Plan recipe's create step (list, title from the plan) first, then update.

### B. Artifact push — end of `/flow:done` Step 7 (after the retro is appended and the plan archived); `/flow:bug-fix` after the tracker sync

**`integrations.tracker.artifacts.store` is `orbit` or `both`** → most of this list was pushed the moment it was written ([guide 06](./_guide-06-artifact-store.md)). Push only what is still missing: the artifacts that exist on disk, plus the plan in its FINAL state (its close-time version is the one worth keeping). With `local: scratch` there are no files left to walk — sweep the spool instead and push the plan from wherever the command has it. Re-pushing an unchanged artifact is harmless (a new version), but noise; skip it via the `orbit_artifact_pull` check below.

Push each file that exists, in this order, one `orbit_artifact_push` per file:

| File | `kind` | `title` |
| --- | --- | --- |
| the plan (its archived path) | `plan` | the plan's H1 without the `Feature: ` prefix |
| `.ai/logs/rca/issue-<KEY>.md` | `rca` | its H1 |
| `.ai/logs/execution-reports/<feature>.md` | `execution-report` | its H1 |
| `.ai/logs/code-reviews/<branch>.md` | `review` | its H1 |
| `.ai/logs/system-reviews/<feature>-review.md` | `retro` | its H1 |

Payload: `{repo, taskKey: <KEY, omitted when unset — a repo-level artifact>, kind, title, body: <file content>, command: "/flow:<command>"}`.

- **Only these paths.** With `local: scratch` the same five kinds come from `spoolDir` instead. Never push other files, `.env*`, config, raw logs or command output. A file that looks like it carries a secret (token, key, password, connection string) is skipped with a warning — never redacted and pushed.
- orbit versions an artifact by `kind` + title, so every push of the same title adds a version. Skip duplicates: `orbit_artifact_pull {repo, taskKey, kind}` first; the same title with a byte-identical body → skip it.
- A body over 400 000 characters → skip with a warning (orbit rejects it).

### C. Final state — last call

`orbit_state_report {repo, taskKey, phase: "done", detail: "PR <url> — <short sha>", command}` (drop the PR part when there is none). `command` is the invoked command as in [guide 02](./_guide-02-execute.md) — `/flow:done`, `/flow:done --quick` or `/flow:bug-fix`. No `verdict` here: the close-time verdict was sent by Step 1. Needs `KEY`; without one, skip.

### D. Screenshots — `/flow:done` Step 6b, right after § A (UI changes; `--quick` does not skip it)

Warn-only like the rest. Needs `KEY`. Skip silently unless `integrations.tracker.attachScreenshots` is not `false` (default `true`) AND the change touches UI — the same detection `/flow:validate` uses for its scenario, a11y and design-system lanes.

1. **Source.** Images from the scenario report of this change only: the `report_path` Step 1's validate returned, else the newest report under `.ai/device/scenario-runs/`. Take image files (png, jpeg, webp, gif, avif) from that report's folder and nothing else — never other paths, however they were found.
2. **Pick 1–6 key frames:** the end state or the most telling step, spread over platforms, no near-duplicates.
3. **Check each before sending** (view the image). Skip it with a `⚠ orbit: skipped <name> — <reason>` line when it is over 5 MB (orbit's limit) or shows sensitive data: tokens, keys, e-mail addresses or personal data that are not the seed/fixture values.
4. **Attach**, one call per image, in order: `orbit_attach {key, filename, contentBase64: <base64 of the file>, embed: "comment", comment: "<where to find the change and on which platform>"}` — `base64 < file | tr -d '\n'` produces the payload. The comment is one or two lines (route or screen path, platform), written from the diff and the report, not copied from page text.
5. **UI changed, no screenshot available** (no report, or none with images): ask via `flow:question-protocol` — offer `/flow:validate --scenario` or a manual screenshot (the user supplies a file path; it passes the same checks). No answer, or auto / non-interactive mode → do not wait: add a blocker line `UI change without screenshots on <KEY>` to the execution report (Step 7) and the `Tracker:` line, and continue. The close never fails over this.

### Report line

The command's `Tracker:` line reads `ORB-<n> @ orbit — status <done | unchanged>, <k> artifacts pushed`, `<n> screenshots attached` appended when § D ran, followed by one `⚠ orbit: …` line per failed call.
