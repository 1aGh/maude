---
name: setup-prd
category: setup
type: command
description: "Create a product requirements document with phase plans and an execution index."
keywords: [prd, requirements, product, document, specification, phases, plans]
argument-hint: "output-filename"
---

# Create PRD

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

## Overview

Generate a Product Requirements Document (PRD) based on the current conversation, then
automatically break it into executable phase plans with a README for running them.

## Output Files

- **PRD:** `$ARGUMENTS` (default: `.ai/docs/PRD.md`). If the work is app-specific, place it in `apps/<app>/.ai/docs/PRD.md` or equivalent instead.
- **Phase plans:** `.ai/plans/phase-{N}-{kebab-name}.md` (one per phase)
- **Execution guide:** `.ai/plans/README.md`

---

## Steps

### 1. Gather Requirements

Ask the user about:

- What are you building? (elevator pitch)
- Who is the target user?
- What problem does this solve?
- What are the must-have features for MVP?
- What's out of scope for now?
- Any technical constraints?

If the user has already described the project in conversation, extract answers from context instead of re-asking.

### 1.5 Product-direction debate (optional — `orchestration.mode`)

A single-pass PRD bakes in the first framing. `/flow:setup-prd` is a **START / divergent** bookend — when eligible, contest the product direction + MVP scope before writing. Read `orchestration.*` from `.ai/workflows.config.json` (DDR-130; **opt-out** — absent → `auto`, ON by default; `mode:off` disables).

- **`relay` tier** (`mode:auto` + `bookends.diverge.enabled != false` + native agent-teams capability `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` detected): load **`flow:debate-protocol`** and seat **`flow:user-advocate`** (who is served, confused, or excluded — voice: customer) and **`flow:shipper`** (what survives scope + effort — voice: minimalist; the MVP-discipline lens). Seats open **blind** on "what should this product BE, and what's the smallest MVP that delivers it"; short-circuit collapses on agreement; on a real fork they cross-challenge (stance revision) and emit one decision.
- **`reduce` tier / no capability**: the same seats as parallel report-back subagents + a consolidator (read-only over outputs).
- **`mode:off`**: skip — single-pass PRD, **unchanged**.

Render **one** `AskUserQuestion` (recommended direction first) per `flow:question-protocol`, or report "converged — <direction>, no choice needed". The chosen direction + MVP scope feed **Step 2 (Write the PRD)** — do NOT fork it. The debate NEVER prompts the user directly and NEVER hand-rolls relay in markdown.

### 2. Write the PRD

Create the document with these sections:

**1. Executive Summary**

- Concise product overview (2-3 paragraphs)
- Core value proposition
- MVP goal statement

**2. Mission**

- Product mission statement
- Core principles (3-5 key principles)

**3. Target Users**

- Primary user personas
- Technical comfort level
- Key user needs and pain points

**4. MVP Scope**

- **In Scope:** Core functionality for MVP (use ✅ checkboxes)
- **Out of Scope:** Features deferred to future phases (use ❌ checkboxes)

**5. User Stories**

- Primary user stories (5-8 stories) in format: "As a [user], I want to [action], so that [benefit]"
- Include concrete examples for each story

**6. Core Architecture & Patterns**

- High-level architecture approach
- Directory structure (if applicable)
- Key design patterns and principles
- Key technology choices

**7. Implementation Phases**

- Ordered phases with clear deliverables
- Dependencies between phases
- Which phases can run in parallel
- MVP phase explicitly marked

**8. Non-Functional Requirements**

- Performance, accessibility, security
- Testing strategy
- CI/CD approach

**9. Success Criteria**

- Measurable outcomes
- Acceptance criteria

**10. Risks & Mitigations**

- Key risks with impact and mitigation strategies

#### Optional Sections (include if relevant)

- Configuration details
- API specifications
- Release process
- Metrics & analytics
- Dependencies & external tools

### 3. Quality Check

After generating the PRD:

- Ensure no contradictions between sections
- Verify all user stories map to scope items
- Check that phases cover all in-scope features
- Confirm risks address implementation challenges

### 4. Generate Phase Plans

For each implementation phase in the PRD, create a separate plan file at
`.ai/plans/phase-{N}-{kebab-name}.md` following the template in `commands/plan-feature.md`:

```markdown
# Phase {N}: {Name}

## Description

<What this phase delivers>

## User Story

As a <user> I want <goal> so that <benefit>

## Problem

<What's missing>

## Solution

<Proposed approach>

## Metadata

- **Type**: [New Feature/Enhancement/Refactor]
- **Complexity**: [Low/Medium/High]
- **Depends on**: [list of prerequisite phases]
- **Parallel with**: [phases that can run simultaneously]
- **Affected Files**: [list]

---

## Tasks

### Task 1: {ACTION} {target}

- **Do**: [specific implementation detail]
- **Pattern**: [reference to existing code or design]
- **Validate**: [how to verify]

### Task 2: ...

---

## Validation

1. **Static**: `<pm> lint`, `tsc -b`, `<pm> build`, `<pm> test`
2. **Cross-platform scenario**: spawn the `scenario-runner` subagent across 5 platforms (web-desktop, web-mobile, ios-phone, ios-tablet, android-phone)
3. **A11y**: spawn the `a11y-auditor` subagent (if UI)
4. **Design system**: spawn the `design-system-guard` subagent (if UI)

---

## Scenario Coverage

| Scenario | Covers user flow | Status |
|----------|------------------|--------|
| `<scenario-name>` | <steps> | 🆕 new |

---

## Acceptance Criteria

- [ ] All tasks completed, `/validate` passes (incl. `scenario-runner` parity)
- [ ] Scenario(s) pass 5/5 platforms (or DDR for intentional divergence)
- [ ] DDRs recorded for architectural decisions
- [ ] ...
```

**Rules for phase generation:**

- **Design phase (optional):** If wireframes / mockups in Claude Design (https://claude.ai/design/) are referenced or the PRD contains screen briefs requiring visual exploration, insert a "Design" phase before Scaffold to capture URLs and finalize design decisions. Skip otherwise.
- **Scaffold phase:** The first code phase should always be "Scaffold" (routing, layout, dependencies, mock data)
- Analyze dependencies between phases — which must run sequentially vs. in parallel
- Each phase plan should be self-contained with enough context to run via `/execute`

### 5. Generate Execution README

Create `.ai/plans/README.md` with:

1. **Dependency graph** — ASCII diagram showing phase order and parallel branches
2. **Execution order table** — step number, phase, file, whether it can run in parallel, the `/execute` command
3. **Copy-paste prompts** — for each phase, a ready-to-use prompt block containing:
   - The `/execute .ai/plans/phase-{N}-{name}.md` command
   - A condensed summary of what to build (enough context that the AI can execute without re-reading the full plan)
   - Key implementation details: components to use, routes, data structures, patterns
4. **Validation commands** — lint, typecheck, build, dev server
5. **Final commit** — `/commit` instruction

### 6. Initialize Workflow State

> **Knowledge-graph backend:** when `maude kg resolve --json` reports `active:true` (load `flow:kgai-backend`), skip this initialization — `/flow:pause` and `/flow:resume` read and write the graph, and `STATE.md` stays a pointer-stub. The steps below are the classic path.

If `.ai/state/STATE.md` does not already exist, initialize it so that session-continuity commands (`/flow:pause`, `/flow:resume`) work from the start:

1. Create the directory: `mkdir -p .ai/state`
2. If `.ai/templates/STATE.md` exists, copy it to `.ai/state/STATE.md`; otherwise create a minimal state file.
3. Populate the fields:
   - **Workflow:** PRD title (from Step 2, Executive Summary)
   - **Phase:** `Phase 1`
   - **Status:** `not-started`
   - **Started:** current date
   - **Updated:** current date

If `.ai/state/STATE.md` already exists, skip this step silently.

### 7. Next Step

After saving all files, report:

> **PRD saved to `{prd-path}`.**
> **{N} phase plans generated in `.ai/plans/`.**
> **Execution guide: `.ai/plans/README.md`**
> **Workflow state initialized at `.ai/state/STATE.md`.**
>
> Start with: `/execute .ai/plans/phase-1-{name}.md`
