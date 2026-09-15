## Execute: working-state reports (`/flow:execute`)

orbit shows the last report as a chip on the task and marks it stale after about two days without one. A report is one small call per milestone — never per edit, per verify run or per file.

Needs `KEY` from the resolver. No key → one line `[orbit] no task key — state reports skipped` and continue.

| Milestone | `orbit_state_report {repo, taskKey, phase, detail}` |
| --- | --- |
| Pre-flight done, before Task 1 | `executing`, `"0/<N> tasks — <plan file name>"` |
| Each task checkpoint (Step 2e, after verify passes) | `executing`, `"<k>/<N> — <task title>"` |
| A task marked `❌ BLOCKED`, or `❌ SMOKE-BLOCKED` | `awaiting`, `"blocked at task <k>: <one-line reason>"` |
| Last task done (Step 4 prompt) | `awaiting`, `"<N>/<N> tasks — ready for /flow:done"` |

`detail` is at most 300 characters and authored by you: task titles from the human-authored plan and your own one-liners only — never ticket prose, command output, file contents or anything secret. Ticket-only mode reports against the human-confirmed task list with the same table.
