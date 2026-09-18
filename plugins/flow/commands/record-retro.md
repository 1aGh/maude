---
name: record-retro
category: record
type: command
description: "\"Compare implementation with its plan and record process improvements.\""
keywords: [process, meta, review, plan, retrospective, improvement]
argument-hint: "[plan-path] [record-execution-path]"
---

# System Review

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Meta-level analysis: how well did the implementation follow the plan?

## Purpose

**System review is NOT code review.** You're looking for bugs in the **process**, not the code.

## Inputs

- Plan file: $1
- Execution report: $2

Also read:

- `.claude/commands/plan-feature.md` (planning process)
- `.claude/commands/execute.md` (execution process)

## Analysis

### Step 1: Extract planned vs actual

Read the plan and execution report. Compare.

### Step 2: Classify divergences

- **Good ✅**: Plan assumption wrong, better approach found, security fix needed
- **Bad ❌**: Ignored constraints, shortcuts, misunderstood requirements

### Step 3: Identify root causes

For each bad divergence:

- Was the plan unclear?
- Was context missing?
- Was validation missing?

### Step 4: Recommend improvements

- **CLAUDE.md updates** — invoke the `claude-md-keeper` skill: scan the divergences for "agent made the same mistake N times" patterns. For each, propose a one-line CLAUDE.md rule that would have prevented the corrections. Show the user; let them accept/edit/decline. Keep CLAUDE.md ≤200 lines (move older rules to `.claude/rules/<topic>.md` if needed).
- Plan command improvements
- Execute command improvements
- New commands to automate repeated manual steps

## Output

Save to: `.ai/logs/system-reviews/<feature-name>-review.md`
> **Artifact store.** Where this artifact lives is `integrations.tracker.artifacts.store` in `.ai/workflows.config.json` — contract in **`flow:orbit-backend`**, [guide 06](../skills/orbit-backend/_guide-06-artifact-store.md). Absent or `local` → the path above, unchanged. `orbit` → author it exactly the same, then `orbit_artifact_push` it as kind `retro` the moment it is written; with `local: scratch` the only copy on disk is a spool file, deleted once orbit confirms the push. `both` → the path above **and** the push. Warn-only in every case: a failed push keeps the file, prints one line and never blocks the retro.


Include:

- Overall Alignment Score: \_\_/10
- Divergence analysis (yaml blocks)
- Pattern compliance checklist
- Specific improvement actions with suggested text
- Key learnings

**Be specific. Don't say "plan was unclear" — say "plan didn't specify which auth pattern to use."**

## Record it in the graph (kgai — when active)

`.ai/logs/**` is **gitignored**, so a retro written today is invisible to the next person unless the graph carries it. Immediately after writing the review file:

```bash
maude kg record-log --file ".ai/logs/system-reviews/<feature-name>-review.md"
```

> **With `artifacts.store: orbit`** the canonical path above does not exist — the artifact is a scratch file that is deleted once orbit confirms the push. Point `--file` at the path you actually wrote and pass the kind explicitly (`--kind system-review`), and run this **before** the push, not after: `kg record-log` reads the file off disk, and directory-based kind inference does not work for a spool file. Full ordering: **`flow:orbit-backend`** [guide 06 §2b](../skills/orbit-backend/_guide-06-artifact-store.md).


The verb gates itself and is a **silent no-op when the graph is inactive** — run it unconditionally; the classic `.ai/` path is unchanged. It lands a `system-review:<slug>` node with the full body plus `EVIDENCE_FOR` edges to every `DDR-NNN` the retro cites — which is what makes "what did we learn about X" answerable from `maude kg search` alone. Contract: **`flow:kgai-backend`**.
