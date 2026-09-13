---
name: record-execution
category: record
type: command
description: "Write an implementation report for system review."
keywords: [report, reflection, implementation, analysis, retrospective]
---

# Execution Report

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Review and deeply analyze the implementation you just completed.

## Context

You have just finished implementing a feature. Reflect on what happened.

## Generate Report

Save to: `.ai/logs/execution-reports/<feature-name>.md`

### Meta Information

- Plan file: [path to plan that guided this implementation]
- Ticket: <id> (if linked; provider per `integrations.tracker.provider`)
- Files added: [list with paths]
- Files modified: [list with paths]
- Lines changed: +X -Y

### Validation Results

- Lint: ✓/✗
- Types: ✓/✗
- Tests: ✓/✗ (X passed, Y failed)
- Build: ✓/✗
- A11y: ✓/✗/skipped
- Visual: ✓/✗/skipped

### What Went Well

- [concrete examples]

### Challenges Encountered

- [what was difficult and why]

### Divergences from Plan

For each divergence:

- Planned: [what plan specified]
- Actual: [what was implemented]
- Reason: [why]

### Skipped Items

- [what was skipped and why]

### Recommendations

- Plan improvements
- Execute improvements
- Rules updates

## Record it in the graph (kgai — when active)

`.ai/logs/**` is **gitignored**, so when the knowledge graph is active it is the only copy of this report that outlives this machine. Immediately after writing the file:

```bash
maude kg record-log --file ".ai/logs/execution-reports/<feature-name>.md"
```

The verb gates itself and is a **silent no-op when the graph is inactive** — run it unconditionally; the classic `.ai/` path is unchanged. It lands an `execution-report:<slug>` node with the full body and an `EVIDENCE_FOR` edge to every `DDR-NNN` cited, matching the shape `maude kg import` produced. Contract: **`flow:kgai-backend`**.
