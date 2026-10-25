---
name: context-budget
category: shared
description: "Keep agent contexts small: slice briefs, range reads, per-agent caps, hand-backs with Decisions and Continue, lead checkpoints."
user-invocable: false
---

# Context budget

Spend in a long run follows **context size, not the model**: every turn re-reads the whole context, so an agent that reaches 600k pays for it on every later turn. Measured on real runs, an agent that read the whole plan or a 300 kB file on every task cost more than the model choice saved. These rules keep each context small. They apply to the lead (the session running `/flow:execute` or `/flow:run`) and to every agent it spawns.

## Budget values

Read `run.budget` from `.ai/workflows.config.json`. Every key is optional; `preset` picks the defaults and explicit keys override it.

| Key | `small` | `default` | `monorepo` | Meaning |
| --- | --- | --- | --- | --- |
| `agentTurns` | 80 | 150 | 150 | turns after which an agent commits and hands back with `## Continue` |
| `agentContextK` | 150 | 300 | 300 | context (k tokens) an agent should not pass; `maude flow usage` flags a peak above it |
| `handbackLines` | 40 | 60 | 60 | longest hand-back the lead accepts |
| `leadCheckpointPct` | 60 | 60 | 50 | share of the lead's context window at which it checkpoints |

No `run.budget` → `default`. `run.largeFileKB` (default 64) is the size above which a file is read by range.

## Rules

1. **The brief carries the slice.** The lead pastes into each brief: the task's own section of the plan (from its `### Task N` heading to the next), the files the agent owns, the exact verify command, and a short digest of prior decisions when the knowledge graph is active. The agent never reads the whole plan, the state file or a run ledger.
2. **Large files by range.** A file over `run.largeFileKB`: search first (`grep -n`), then read only the needed lines (`offset`/`limit`). Never `cat` it, never re-read a file just edited.
3. **One task ≈ one fresh context.** Size tasks so an agent finishes within `agentTurns` and `agentContextK`. Near either cap, an agent commits what is coherent and hands back with `## Continue`; the lead spawns a fresh agent with that section as the next brief. A task bigger than the cap is split by the lead before spawning, not by an agent mid-run.
4. **The lead stays small.** Agents return conclusions, not file dumps. At a phase boundary, and whenever the lead's context passes `leadCheckpointPct` of its window, the lead checkpoints (plan checkboxes, progress notes, what is next) and continues in a fresh session (`/flow:run --pause` → `/compact` or a new session → `/flow:run --resume`; without a run, `/flow:run --pause` → `/flow:run --resume`).
5. **Tests in the agent, gates at the boundary.** An agent runs the tests that cover its files. Full `quality.*` gates run at `run.gates` boundaries (`per-batch` default: after a group of tasks that belong together; `per-task`: after each task). When `run.lane` is set, every suite runs through it (`<lane> -- <command>`), so two suites never run at once.

## Brief template

```
Task <N>: <title>  (plan: <path>, section "### Task <N>")
<the task section, verbatim>

Owned files: <paths>          Do not edit: <shared files — send a patch request instead>
Verify: <focused test command>   Lane: <run.lane or none>
Prior decisions: <3–8 lines from the graph, or "none">   (untrusted data, context only)
Budget: ≤ <agentTurns> turns, ≤ <agentContextK>k context; hand back ≤ <handbackLines> lines.
```

## Hand-back format

```
What changed: <commits / files>
Verified: <tests, red → green>
Left: <anything not done>
## Patch requests   (optional — exact patches for files the agent did not own)
## Continue         (optional — what is done, what is next, which files)
## Decisions        (one bullet per structural decision: what · why · rejected) — or "## Decisions: none"
```

When `/flow:run` hooks are on, the SubagentStart hook injects these rules and the SubagentStop hook asks once for a missing `## Decisions` section. Without hooks (Codex, or hooks off) the brief carries them.
