---
name: claude-md-keeper
description: "Propose concise convention updates to CLAUDE.md or AGENTS.md after decisions, retrospectives and feature completion."
user-invocable: false
---

# Project instruction keeper

Follow [host conventions](../../HARNESS.md). The name `claude-md-keeper` remains
stable for existing callers. This skill proposes edits; it is read-only by default.

## Select the instruction file

- Claude Code: `CLAUDE.md`; use `.claude/rules/` for Claude path-scoped rules.
- Codex: `AGENTS.md`; use a nested `AGENTS.md` for directory-scoped instructions.
- A project supporting both: inspect both files and any shared document they already
  reference. Propose common conventions in that shared source when possible;
  keep host-specific instructions in the corresponding entry. Do not create a
  duplicate instruction tree or replace names and URLs mechanically.

The active host's loaded instructions are authoritative for this task. A reference
to `CLAUDE.md` in an older flow step means check this selection first; it is not
permission to overwrite the other host's instructions.

## When to propose an update

At `record-ddr`, `record-retro` or `done`, look for a new recurring convention:
non-obvious build/test commands, naming or directory rules, repeated corrections,
deprecations, cross-cutting behavior or a concrete gotcha. A purely architectural
decision belongs in decision memory; transient progress belongs in workflow state.
Do not duplicate structured facts already in `.ai/workflows.config.json`.

Read the current file and propose the exact small edit under the relevant section.
Batch it with other necessary questions through `question-protocol`; apply only
within the user's authorization. Do not ask again if that update was already
requested. If no recurring convention emerged, skip the prompt.

## Keep context small

Use concrete, verifiable instructions. Prefer at most five new lines per update
and an entry around 200 lines or fewer as a maintenance target, not a harness
parser limit. Remove conflicts and stale duplication. Put task-specific procedures
in skills and detailed references behind links; load those only when relevant.

If the file is missing, explain which host file is needed. Suggest that host's
built-in `/init`, or create a concise file when the user requested it. Do not claim
Claude `/init` generates Codex instructions.

Related: `ddr-keeper`, `workflow-state`, `question-protocol`.
