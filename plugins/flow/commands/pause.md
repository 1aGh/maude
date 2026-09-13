---
name: pause
category: daily
type: command
description: "Save workflow state and a handoff for a later session."
keywords: [pause, stop, save, session, handoff, continuity, break]
---

# Pause Work: Save Session State

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

## Objective

Safely pause the current workflow with full context preserved. Writes a handoff artifact and updates workflow state so the next session (or another developer) can pick up exactly where you left off.

## Package Manager Auto-Detection

> This command uses `<pm>` as a placeholder for your package manager. Detect it:
>
> - `pnpm-lock.yaml` → `pnpm`
> - `yarn.lock` → `yarn`
> - `package-lock.json` → `npm run`

## Process

### 1. Capture Current State

Read `.ai/state/STATE.md` if it exists. Extract:

- Current phase
- Active task
- Blockers
- Decisions made

If `STATE.md` does not exist:

> ⚠️ No active workflow state found. Creating a minimal handoff from git state only.

### 2. Capture Git State

```bash
# Current branch
git branch --show-current

# Working tree changes
git status --short

# Diff stats
git diff --stat

# Commits ahead of main
git log origin/main..HEAD --oneline 2>/dev/null || git log main..HEAD --oneline
```

### 3. Write HANDOFF.md — **classic backend only**

> **Skip this entire step when the knowledge graph is active** (`maude kg resolve --json` → `active:true`; load `flow:kgai-backend`). Step 4b records the same context as a `session:` **paused event** in the graph, which `/flow:resume` reads back. Writing the file too would fork the handoff across two stores and leave a stale `.md` the next resume might trust. Under kgai there is no `HANDOFF.md` and no `.ai/templates/HANDOFF.md` to copy.

Create the state directory if needed:

```bash
mkdir -p .ai/state
```

Write `.ai/state/HANDOFF.md` using the template from `.ai/templates/HANDOFF.md`, filling in all fields from the gathered context:

- **Project:** from `.ai/workflows.config.json` → `name` (or repo basename as fallback)
- **Branch:** from `git branch --show-current`
- **PR:** from `gh pr view --json url -q .url 2>/dev/null` or "none"
- **Last session:** current timestamp
- **Phase / Active task / Status:** from STATE.md or "no active workflow"
- **Completed Work:** from STATE.md history or recent commits
- **Remaining Work:** from STATE.md or plan file
- **Open Decisions:** from STATE.md decisions section
- **Blockers:** from STATE.md blockers section
- **Files Changed:** from `git diff --name-only HEAD` + `git diff --name-only --staged`
- **Notes for Next Session:** summarize the immediate next action

### 4. Update STATE.md — **classic backend only**

> **Skip when the graph is active.** The history row belongs in the graph (step 4b); under kgai `STATE.md` is a thin pointer-stub and appending to it would grow the very file the migration retired.

If `.ai/state/STATE.md` exists:

1. Update **Status** → `paused`
2. Update **Updated** → current timestamp
3. Append a history entry:

```
| <timestamp> | <current-phase> | Paused — <brief reason> |
```

If STATE.md doesn't exist, skip this step (handoff alone is sufficient).

### 4b. Knowledge-graph pause event (kgai — when active)

Load **`flow:kgai-backend`** and check `maude kg resolve --json`.

- **`active: false`** (default) → skip; HANDOFF.md + STATE.md above are the source of truth, unchanged.
- **`active: true`** → the graph is the source of truth; record a **paused event** linked to the active plan, then **sync**. This event is the *only* record of the pause — Steps 3 and 4 were skipped, so there is no `HANDOFF.md` and no STATE.md row to fall back on, and `/flow:resume` reconstructs entirely from here. Put everything the next session needs into the props; a thin `rationale` here is a genuinely lost handoff, not a terse one.

  ```bash
  echo '{"decision":{"title":"Paused: <feature>","rationale":"<why paused>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"session","name":"<plan-slug>-paused","props":{"phase":"<phase>","active_task":"<task>","blockers":"<blockers>","open_decisions":"<open>"}},{"op":"add_link","from":"session:<plan-slug>-paused","to":"plan:<plan-slug>","link":"PAUSES"}]}}' | maude kg ingest --root .
  maude kg sync --warn-only --root .   # push; no-op when local-only, warns (never blocks) on failure
  ```

  Author is stamped automatically (`git config user.name`), so `/flow:resume` can find *your* last pause.

### 5. Print Summary

Output a brief summary to the user:

```
📋 Work paused.

  Branch: <branch>
  Phase:  <phase or "no active workflow">
  Done:   <count> tasks completed
  Left:   <count> tasks remaining
  Files:  <count> modified

  Handoff: .ai/state/HANDOFF.md
  State:   .ai/state/STATE.md

  Resume later with `/flow:resume`.
```

## Output

Two files written:

- `.ai/state/HANDOFF.md` — full context for the next session
- `.ai/state/STATE.md` — updated status (if it existed)

## Notes

- You can share `.ai/state/HANDOFF.md` with another developer for pair handoff
- The handoff includes enough context to resume without reading the full plan
- Run `/flow:resume` to pick up where you left off
