---
name: workflow-state
type: skill
description: "Read and update workflow state when planning, executing, completing, pausing or resuming project work."
keywords: [state, workflow, phase, handoff, continuity, session]
---

# Workflow State

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

`.ai/state/STATE.md` is the single source of truth for "what's happening right now." It's read by `/status`, `/resume`, `/done`, and any future agent that joins mid-feature. Keep it accurate.

This skill complements `workflow-orchestration` (which covers the protocol of phases & gates). This skill focuses on the **STATE.md schema and lifecycle**.

## Backend: file vs. knowledge graph (kgai-aware)

Load **`flow:kgai-backend`** and check `maude kg resolve --json` before treating STATE.md as authoritative:

- **`active: false`** (default — most repos) → the schema below **is** the source of truth. Everything in this skill applies unchanged. No regression.
- **`active: true`** → the **knowledge graph is the history authority**, and `.ai/state/STATE.md` is a thin human-readable **pointer-stub** (written by `maude init --kg`): status line + "history lives in kgai — `kg history` / `kg context`". History rows, the Decisions section, and pause/resume state live as graph events (see `flow:kgai-backend` for the `plan:`/`session:` recipes; `/flow:pause` records a `paused` event, `/flow:resume` reconstructs from it, `/flow:status` overlays `kg history`/`kg context`). Do NOT append full History rows to the stub — write the movement to the graph instead. The narrative files STATE.md never owned (PRD, design-system, plans) stay on disk as prose.

**This is behind the `active` gate — an inactive repo keeps the full STATE.md below, untouched (slim, never gut).**

## STATE.md schema

```markdown
# Workflow State

**Workflow:** ad-hoc
**Phase:** intake | discovery | design | planning | execution | verification | done | paused | blocked
**Status:** ready | in-progress | paused | blocked | done
**Started:** <YYYY-MM-DD>
**Updated:** <YYYY-MM-DD HH:MM>
**Active task:** <one-liner from the plan or "—">
**Active plan:** <.ai/plans/<x>.plan.md, or `plan:<slug>` when the plan lives in orbit, or "—">

## Decisions

<bullet list — short summaries; full DDRs live in .ai/decisions/>

## Blockers

<bullet list — what is in the way, who must decide it>

## History

| When | Phase | Note |
| ---- | ----- | ---- |
| <YYYY-MM-DD HH:MM> | <phase> | <one-liner> |
```

## Rules

1. **Every phase change → a new history row.** History is append-only — no row gets rewritten, removed, or reordered.
2. **Update the Updated field on every edit.** `/status` and `/resume` use it to detect stale state.
3. **Pause path:** Phase → `paused`, Status → `paused`, keep the current `Active task` (do not clear it). Details go in `.ai/state/HANDOFF.md`.
4. **Done path:** Phase → `done`, Status → `done`, Active task → `—`, Active plan → `—`. The plan moves to `.ai/plans/archive/` — unless `integrations.tracker.artifacts.store` is `orbit`, where there is no local archive and the **Active plan** line holds the orbit slug (`plan:<slug>`) instead of a path, so `/flow:resume` and `/flow:status` know to pull it (`flow:orbit-backend` [guide 06](../orbit-backend/_guide-06-artifact-store.md)).
5. **Blocked:** Phase stays the same, Status → `blocked`, the Blockers section gets a bullet with the specifics.

## HANDOFF.md (only while paused)

A transient file. Created on `/pause`, removed on `/resume`. **Never committed standalone** — it lives in `.gitignore`. If it appears in git, that is a leak.

Use `.ai/templates/HANDOFF.md` as the base. Key sections:

- Active feature
- Last task (with status)
- Next step (concrete command / file / line)
- Open questions / blockers
- Files touched (uncommitted)
- Recent thinking (1–2 paragraphs — trail of thought)

## Anti-patterns

- ❌ Hand-editing History without a phase change.
- ❌ Deleting History rows to "clean up" — that is institutional amnesia.
- ❌ STATE.md committed with status `in-progress` on the main branch — either work is `done`, or it lives in a PR.
- ❌ HANDOFF.md committed — it is gitignored for a reason.
- ❌ Multiple active plans at once without an explicit reason — if you want to drive two things in parallel, use branches, not one state.

## Integration

| Command | What it does with STATE.md |
|---------|----------------------------|
| `/plan` | Phase → `planning`, Active plan → `<path>`, history row |
| `/execute` | Phase → `execution`, Active task per task, history row per completed task |
| `/done` | Phase + Status → `done`, plan archived, final history row |
| `/pause` | Status → `paused`, Active task kept, creates HANDOFF.md |
| `/resume` | Status → `in-progress`, removes HANDOFF.md, history row |
| `/status` | Read-only — returns summary |
| `/flow:record-ddr` | Appends to `## Decisions` (summary only, full DDR in `.ai/decisions/`) |
