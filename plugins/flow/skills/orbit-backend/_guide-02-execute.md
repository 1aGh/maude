## Execute: working-state reports (`/flow:execute`)

orbit shows the last report as a chip on the task and marks it stale after about two days without one. A report is one small call per milestone — never per edit, per verify run or per file.

Needs `KEY` from the resolver. No key → one line `[orbit] no task key — state reports skipped` and continue.

| Milestone | `orbit_state_report {repo, taskKey, phase, detail, command, verdict?}` |
| --- | --- |
| Pre-flight done, before Task 1 | `executing`, `"0/<N> tasks — <plan file name>"` |
| Each task checkpoint (Step 2e, after verify passes) | `executing`, `"<k>/<N> — <task title>"` |
| A task marked `❌ BLOCKED`, or `❌ SMOKE-BLOCKED` | `awaiting`, `"blocked at task <k>: <one-line reason>"` |
| Last task done (Step 4 prompt) | `awaiting`, `"<N>/<N> tasks — ready for /flow:done"` |
| `/flow:validate` or `/flow:validate --fast` finished, when the user invoked it (not when execute or done calls it — they own their own reports) | `awaiting` (a person decides next), `"validate: <result>, <n> findings — next: /flow:done"` on pass/partial, `"… — next: fix"` on fail, `verdict` |
| `/flow:done` Step 1 finished (it runs validate; validate then sends nothing of its own) | verdict `pass` / `partial` → `executing`, `"closing — validate <result>"`; `fail` → `awaiting`, `"validate failed — back to /flow:execute"`; `verdict` |

### `command` — on every report

`command` is the command as the user invoked it: `/flow:<name>` plus its bare flags — `/flow:execute`, `/flow:done`, `/flow:done --quick`, `/flow:validate --fast`, `/flow:bug-fix`. It must match `^/flow:[a-z-]+( --[a-z-]+)*$` (max 60), so drop flag values, paths, ticket keys and quoted text; a flag with a value is sent bare or not at all. Send it on every report in every guide (Plan, Execute, Close); orbit shows which command produced the chip.

### `verdict` — validate and done Step 1 only

`verdict: {result, findings}` is the outcome of a validation run, never sent on milestone reports.

| `result` | When |
| --- | --- |
| `pass` | every gate that ran is green, no finding at or above `security.severityFloor` |
| `partial` | green but with warnings, or some gates/lanes deferred (`--fast` deferrals, an unbooted device, a skipped lane) |
| `fail` | a hard gate failed (run stopped on it) or a finding at or above the floor |
| `skipped` | nothing ran — validate's skip-if-clean hit on a byte-identical green tree |

`findings` is the count of blocker plus warning findings in the report (integer 0..999, capped; omit it when unknown). Both fields are optional on the wire and the report stays warn-only: an orbit that predates them ignores them ([guide 05](./_guide-05-untrusted-data-and-failure.md)).

`detail` is at most 300 characters and authored by you: task titles from the human-authored plan and your own one-liners only — never ticket prose, command output, file contents or anything secret. Ticket-only mode reports against the human-confirmed task list with the same table.
