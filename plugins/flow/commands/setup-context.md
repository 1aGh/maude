---
name: setup-context
category: setup
type: command
description: "Load relevant codebase context for the current project and task."
keywords: [prime, onboard, codebase, understand, explore]
---

# Prime: Load Project Context

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

## Objective

Build comprehensive understanding of the current project by analyzing structure, documentation, and key files — scoped to what the user is working on.

## Package Manager Auto-Detection

> This command uses `<pm>` as a placeholder for your package manager. Detect it:
>
> - `pnpm-lock.yaml` → `pnpm`
> - `yarn.lock` → `yarn`
> - `package-lock.json` → `npm run`

## Repository Auto-Detection

```bash
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||')"
```

## Process

### 1. Read project identity (structured + prose)

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

Two complementary sources — read both when present:

- **`.ai/workflows.config.json`** — structured machine-readable identity (`name`, `platforms`, `boundaries`, `integrations.tracker`, `motion`, `responsive`, …). Source of truth for command-driven lookups.
- **`CLAUDE.md`** (or `.claude/CLAUDE.md`) — prose Claude reads every session: conventions, build commands, prohibited packages, "always do X" rules. Auto-loaded; you may already have its content in context.

If `.ai/workflows.config.json` does not exist:

> ⚠️ No flow workspace found. Run `/flow:init` to scaffold `.ai/` and populate the config. Continuing with `CLAUDE.md` and auto-detection only.

If `CLAUDE.md` does not exist:

> ⚠️ No CLAUDE.md found. Run Anthropic's built-in `/init` to generate one tailored to your codebase. Continuing with auto-detection only.

### 2. Ask: What area are you working on?

If the project is a monorepo (detected from `pnpm-workspace.yaml`, `lerna.json`, `nx.json`, `turbo.json`, or `.ai/workflows.config.json` has signals of multiple platforms):

Present a picker using the `ask_user_question` tool listing the apps/packages from the workspace config.

If the project is a single-repo: skip this step — load the whole project.

Wait for the user's response before continuing.

### 3. Read Core Rules (always)

Read `CLAUDE.md` — pay special attention to:

- **Rules** section (hard constraints)
- **Prohibited packages** or legal restrictions
- Any project-specific conventions

### 4. Load Project-Specific Context

Based on the user's selection:

1. Read the selected app/package's `CLAUDE.md` or `README.md` if present
2. Read any rule files in the app directory (`.ai/docs/rules.md`, `docs/rules.md`)
3. Read architecture docs if present
4. Read project structure docs if present

Recent activity:

```bash
git log -10 --oneline -- <selected-path>/
git status -- <selected-path>/
```

Check plans:

```bash
find . -path '*/plans/*.md' -not -path './node_modules/*' 2>/dev/null | head -10
```

### 5. Understand Current State

```bash
git log -10 --oneline
git status
git branch --show-current
```

### 6. Count Asset Inventory

Run filesystem counts to establish the current inventory:

```bash
echo "Commands: $(find .claude/commands -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
echo "Agents: $(find .claude/agents -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
echo "Skills: $(find .claude/skills -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
echo "Prompts: $(find .ai/prompts -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
echo "Instructions: $(find .github/instructions -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
```

### 7. Detect Active Domain & Recommend Agent

1. Gather recently touched files:

```bash
git diff --name-only HEAD~3..HEAD 2>/dev/null || echo "No recent changes detected"
git diff --name-only 2>/dev/null
```

2. If an agent routing configuration exists, read it and match touched file patterns against the routing table triggers.
3. Include the result in the **Recommended Agent** section of the Output Report below.

> If `git diff` returns empty (fresh clone or clean tree), output: "No recent changes detected; no agent recommendation."
> The recommendation is advisory — the user may override.

## Output Report

### Project Overview

- Which area was loaded
- Current branch and recent commits

### Key Rules

- List key rules from `CLAUDE.md`

### Current State

- Active branch
- Uncommitted changes
- Open plans

### Capabilities Summary

- **Commands:** {count} available (list top 5 most relevant to chosen area)
- **Agents:** {count} available (list all with one-line descriptions)
- **Skills:** {count} available (list all with one-line descriptions)
- **Prompts:** {count} available (list all with one-line descriptions)

### Recommended Agent

Based on recently touched files:

- **Primary:** `<agent-name>` — <reason>
- **Also relevant:** `<agent-name>` — <reason> (if multiple matches)
- If no trigger matched: "No agent recommendation — proceed without loading an agent."

**Make this summary easy to scan — use bullet points and clear headers.**
