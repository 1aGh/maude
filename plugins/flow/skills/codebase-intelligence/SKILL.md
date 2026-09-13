---
name: codebase-intelligence
type: skill
description: "Create or refresh a codebase architecture snapshot, detect stale context and reuse project analysis."
keywords:
  [codebase, map, architecture, context, snapshot, analysis, intelligence]
---

# codebase-intelligence

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Produce structured architecture context from actual source evidence. Preserve the snapshot schema and distinguish observations from inference. Check snapshot and sidecar freshness before reuse; a cached map is not proof of current code. Analyze only relevant project areas, with the monorepo procedure when appropriate.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| When performing this stage: When to Use This Skill | [When to Use This Skill](./_guide-01-when-to-use-this-skill.md) |
| When performing this stage: Snapshot Schema | [Snapshot Schema](./_guide-02-snapshot-schema.md) |
| When performing this stage: Analysis Techniques | [Analysis Techniques](./_guide-03-analysis-techniques.md) |
| Only when the target is a monorepo | [Monorepo Handling](./_guide-04-monorepo-handling.md) |
| Before reusing cached project context | [Staleness](./_guide-05-staleness.md) |
| Before reusing cached project context | [Sidecar cache freshness gate (Phase C / DDR-061)](./_guide-06-sidecar-cache-freshness-gate-phase-c-ddr-061.md) |
| When performing this stage: Integration | [Integration](./_guide-07-integration.md) |
