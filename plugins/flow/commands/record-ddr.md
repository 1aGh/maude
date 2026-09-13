---
name: record-ddr
category: record
description: "Record an architectural or product decision with its rationale."
argument-hint: "<short decision title>"
---

# /flow:record-ddr — record a decision

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

A DDR (Design Decision Record) is a formal record of a non-trivial decision that affects future development. The next instance of Claude Code (and humans) read it to understand **why** something is the way it is.

> Use a DDR for: library / framework choice, data model schema, API shape, authorization model, performance trade-off, rebuild vs. refactor, deprecation. **Don't use** for: obvious decisions, local refactor, bug fix without conceptual impact.

## Step 0 — Resolve the backend (kgai-aware)

Load the **`flow:kgai-backend`** skill and resolve the backend once: `maude kg resolve --json` → `{ active, scope, … }`.

- **`active: false`** (kgai absent / `mode:off` / no store — the default for most repos) → run the classic file-based **Process** below **unchanged**. This is the no-regression path; everything after Step 0 is exactly today's behavior.
- **`active: true`** → record the decision into the knowledge graph instead of a `DDR-NNN.md` file. `kg ingest` reads a decision object on **stdin** (the `flow:kgai-backend` skill owns the full recipe):

  ```bash
  echo '{ "decision": {
    "title": "<Title>", "rationale": "<why>", "date": "<YYYY-MM-DD>",
    "mutations": [
      { "op": "upsert_element", "kind": "decision", "name": "<slug>" },
      { "op": "upsert_element", "kind": "repo", "name": "<config.scope.repo>" },
      { "op": "upsert_element", "kind": "dept", "name": "<config.scope.dept>" },
      { "op": "add_link", "from": "decision:<slug>", "to": "repo:<repo>", "link": "IN_REPO" },
      { "op": "add_link", "from": "decision:<slug>", "to": "dept:<dept>", "link": "IN_DEPT" },
      { "op": "add_link", "from": "decision:<slug>", "to": "decision:<other>", "link": "SUPERSEDES" }
    ] } }' | maude kg ingest
  ```

  1. **Author is automatic** (kgai `guessActor()` → `git config user.name`, stamped at `kg init`) — do not set it.
  2. **Scope tags** — include the `repo:`/`dept:` upserts + `IN_REPO`/`IN_DEPT` links from `config.knowledgeGraph.scope` (never literals). No manual DDR number — kgai's deterministic `hash(kind:name)` identity removes the shared-`main` numbering race entirely.
  3. **Cross-ref links** — parse the decision body for `Supersedes:`/`Related:`/`Extends:`/`Amends:` markers and add an `add_link` mutation per match (`SUPERSEDES`/`REFERENCES`/`EXTENDS`; same classifier as `cli/lib/ddr-to-kgai.mjs`).
  4. **No file, no index, no STATE Decisions row** — the graph is the store. The `.ai/decisions/` archive stays read-only (never deleted).
  5. Still run the **CLAUDE.md sweep** (Process step 5) if the decision encodes a behavioral rule, and **Report** the resolved element id instead of `DDR-NNN`.

The rest of this command (asking the batch of questions in Process step 2, the CLAUDE.md sweep, the report) is shared — only the *storage* (file vs. graph) branches on `active`.

## Process

1. **Find the next number** — `ls .ai/decisions/DDR-*.md 2>/dev/null | tail -1` → +1, padded to 3 digits (DDR-001, DDR-002…).

2. **Ask in one batch** (if the user hasn't supplied everything in `$ARGUMENTS`):
   - What is the problem / opportunity?
   - What alternatives did you consider?
   - Which one did you pick and why?
   - What are the consequences (positive and negative)?
   - Is there a superseding condition (when to revisit)?
   - **(UI-affecting decisions only)** If the title/context mentions UI concerns (`UI`, `layout`, `color`, `typography`, `interaction`, `spacing`, `component`, `motion`, etc.) and the project uses the design plugin, also ask: _"This decision touches UI. Does it reference a specific canvas? [Type a `.design/...` path or N]"_. See the `ddr-keeper` skill for the full heuristic. Validate the path exists; if the user gives a path that doesn't, warn and record it anyway (the canvas may land later).

3. **Write** to `.ai/decisions/DDR-<NNN>-<kebab-title>.md`:

```markdown
# DDR-<NNN>: <Title>

**Status:** Accepted | Proposed | Superseded by DDR-<NNN>
**Date:** <YYYY-MM-DD>
**Tags:** <e.g. video, playbook, auth, infra, ux>
**Related canvas:** <.design/... path — only when a UI-affecting DDR references one; omit the line otherwise>

## Context
What is the problem? What constraints exist? What is blocked until we decide?

## Alternatives considered
- **Option A:** <brief> — pros: …, cons: …
- **Option B:** <brief> — pros: …, cons: …
- **Option C:** <brief> — pros: …, cons: …

## Decision
We pick **<option>** because:
- <reason 1>
- <reason 2>

## Consequences
**Positive:**
- <what we gain>

**Negative / trade-offs:**
- <what we lose or complicate>

## Revisit when
<condition under which to revisit — e.g. "users > 10k", "when v2 broadcast pillar arrives">

## Linked
- Plan: <path or —>
- PRD: <§ or —>
- Supersedes: DDR-<NNN> or —
```

4. **Write the index** — append a line to `.ai/decisions/README.md` (create if missing):
   ```
   - [DDR-<NNN>: <Title>](DDR-<NNN>-<slug>.md) — <YYYY-MM-DD>, <tags>
   ```

5. **CLAUDE.md sweep** — if the decision encodes a behavioral rule for future code (a "we always do X" / "we never do Y" clause), invoke the `claude-md-keeper` skill: propose a one-line addition to CLAUDE.md so future sessions follow the rule without re-reading the DDR. Skip silently if the DDR is purely architectural with no behavioral change (e.g. "we picked Postgres over MySQL" alone is not a CLAUDE.md rule; "we always use Drizzle for queries, never raw SQL" is).

6. **Report** — _"DDR-<NNN> recorded. Link it in the active plan / commit message."_
