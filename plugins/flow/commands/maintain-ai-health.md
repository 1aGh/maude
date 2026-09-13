---
name: maintain-ai-health
category: maintain
type: command
description: "Check project skills, agents, commands, workflow state and codebase-map health."
keywords: [health, check, diagnose, verify, ai, system, status]
---

# AI Health: System Diagnostic

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

> Verify that the `.claude/` + `.ai/` infrastructure is complete. Reports pass/warn/fail with remediation steps.

## Process

Run each check in order. Collect results into a summary table.

### Check 1: Slash commands

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CMD_DIR="${REPO_ROOT}/.claude/commands"
```

- **Pass:** `$CMD_DIR` exists and contains ≥ 5 `.md` files (minimum: setup-prd, plan, execute, done, setup-context)
- **Fail:** Directory missing or under-populated

**Remediation:** Restore from the `ai-loop/` backup or from git (`git checkout HEAD -- .claude/commands`).

### Check 2: Skills

```bash
SKILLS_DIR="${REPO_ROOT}/.claude/skills"
```

- **Pass:** Directory exists and contains ≥ 1 subdirectory with `SKILL.md`
- **Warn:** Directory exists but is empty
- **Fail:** Directory missing

**Remediation:** Skills are auto-loading expertise. Without them commands still run, but without domain detail.

### Check 3: Subagents

```bash
AGENTS_DIR="${REPO_ROOT}/.claude/agents"
```

- **Pass:** Directory exists with ≥ 1 `.md` file
- **Warn:** Directory empty — subagents for a11y / design-system / test-coverage are missing

**Remediation:** Subagents hold robustness. Restore or create.

### Check 4: CLAUDE.md

```bash
CLAUDE_FILE="${REPO_ROOT}/CLAUDE.md"
```

- **Pass:** File exists and is non-empty
- **Fail:** File missing

**Remediation:** `CLAUDE.md` is root-level guidance for future Claude sessions. Run `/init` if missing.

### Check 5: PRD + Design System

- **Pass:** `.ai/<project>-prd.md` + `.ai/<project>-design-system.md` exist and are non-empty
- **Fail:** One or both missing

**Remediation:** These two documents are the source-of-truth for the product. Without them you cannot plan.

### Check 6: Codebase Map (warm cache)

```bash
MAP_FILE="${REPO_ROOT}/.ai/context/codebase-map.md"
```

- **Pass:** File exists and was updated in the last 7 days
- **Warn:** File exists but is older than 7 days (potentially stale)
- **Fail:** File missing
- **N/A:** Repo has no code yet (planning phase)

**Remediation:** `/flow:setup-codebase-map` generates / refreshes the snapshot.

### Check 7: Workflow State

```bash
STATE_FILE="${REPO_ROOT}/.ai/state/STATE.md"
```

- **Pass:** File exists (workflow state initialized) — **or** the knowledge graph is active (`maude kg resolve --json` → `active:true`), in which case a missing/stub `STATE.md` is CORRECT: continuity lives in the graph, not the file.
- **Warn:** File missing AND the graph is inactive — commands still run, but `/pause` and `/resume` will not preserve context

**Remediation (classic backend only):** `cp .ai/templates/STATE.md .ai/state/STATE.md`

### Check 8: Decisions log

```bash
DDR_DIR="${REPO_ROOT}/.ai/decisions"
```

- **Pass:** Directory exists with `README.md` index
- **Warn:** Directory missing — DDR learning loop is not active

**Remediation:** `mkdir -p .ai/decisions` + copy the README.md template.

## Output Report

### AI System Health

| # | Check | Status | Detail |
| - | ----- | ------ | ------ |
| 1 | Commands | ✅/❌ | {count} commands |
| 2 | Skills | ✅/⚠️/❌ | {count} skills |
| 3 | Subagents | ✅/⚠️ | {count} agents |
| 4 | CLAUDE.md | ✅/❌ | Present / Missing |
| 5 | PRD + Design System | ✅/❌ | Both present / Missing |
| 6 | Codebase Map | ✅/⚠️/❌/N/A | Fresh / Stale / Missing / Pre-code |
| 7 | Workflow State | ✅/⚠️ | Initialized / Not initialized |
| 8 | Decisions log | ✅/⚠️ | Active / Not started |

### Summary

- **Healthy:** All checks pass — AI infrastructure is fully operational
- **Needs attention:** Warnings — works, but not ideal
- **Needs repair:** Failures — follow the remediation steps
