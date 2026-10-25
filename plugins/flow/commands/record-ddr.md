---
name: record-ddr
category: record
description: "Record an architectural or product decision with its rationale."
argument-hint: "<short decision title>"
---

# /flow:record-ddr — record a decision

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

A DDR (Design Decision Record) records a non-trivial decision that affects future development, so the next session (and human) knows **why** something is the way it is. This command also owns the former `ddr-keeper` skill: recognising DDR-worthy moments and insisting on quality.

## When a decision is DDR-worthy

Worthy if any holds: a choice between two or more genuinely viable libraries / frameworks / patterns · the shape of a data model, API, auth flow, permission model or schema · saying "no" to something the PRD seems to imply · a performance / DX / cost trade-off where the opposite is defensible · deprecating or replacing an approach · a pivot during `/execute` that diverges from the plan · a convention other features will copy · choosing a changelog provider (`integrations.changelog.provider` affects every contributor; record the **Revisit when** trigger).

**Not worthy:** mechanical rename / format / lint fix · follows directly from the PRD or design-system doc · already covered by an existing DDR · local refactor with no public-API impact.

**Triggers:** `/plan` flags forks under `## Decisions to record` (flag only, don't write yet) · `/execute` halts on a plan-diverging pivot and runs this command before continuing · `/done` sweeps `## Decisions to record` and every unrecorded item becomes a DDR before commit · the retro looks for repeated decisions to promote. When the conversation hits a worthy moment, say so ("This is DDR-worthy — let's capture it") and run this command.

**Quality gate — refuse weak content:** at least 2 alternatives (even "do nothing"); `Consequences` split into positive and negative; `Revisit when` a concrete trigger, not "if we have problems". Anti-patterns: a DDR written after the fact to rationalise; a single alternative (that's a default, not a decision); vague consequences ("improves maintainability"); skipping `Revisit when`.

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
  5. Still run the **instruction-file sweep** (Process step 5) if the decision encodes a behavioral rule, and **Report** the resolved element id instead of `DDR-NNN`.

The rest of this command (asking the batch of questions in Process step 2, the instruction-file sweep, the report) is shared — only the *storage* (file vs. graph) branches on `active`.

## Process

1. **Find the next number** — `ls .ai/decisions/DDR-*.md 2>/dev/null | tail -1` → +1, padded to 3 digits (DDR-001, DDR-002…).

2. **Ask in one batch** (if the user hasn't supplied everything in `$ARGUMENTS`):
   - What is the problem / opportunity?
   - What alternatives did you consider?
   - Which one did you pick and why?
   - What are the consequences (positive and negative)?
   - Is there a superseding condition (when to revisit)?
   - **(UI-affecting decisions only)** If the title/context mentions UI concerns (`UI`, `layout`, `color`, `typography`, `interaction`, `spacing`, `component`, `motion`, etc.) and the project uses the design plugin, also ask: _"This decision touches UI. Does it reference a specific canvas? [Type a `.design/...` path or N]"_. Trigger only when the title/context has a UI keyword (UI, UX, layout, colo(u)r, typography, font, spacing, interaction, animation, motion, component, icon, theme, density, responsive, a11y on a visual surface) AND the design root (`paths.designRoot`, default `.design`) exists; otherwise skip silently. Validate the path; if it doesn't resolve, warn (`⚠ <path> not found — recording anyway`) and record it regardless. N → omit the line, don't nag.

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

4. **Write the index** (file backend only — with the graph active there is no README; `maude kg search` is the index). Append to the decisions README, resolved as `.ai/archive/decisions/README.md` when that directory exists, else `.ai/decisions/README.md` (appending to the old path of a migrated repo recreates a second index):
   ```
   - [DDR-<NNN>: <Title>](DDR-<NNN>-<slug>.md) — <YYYY-MM-DD>, <tags>
   ```

5. **Instruction-file sweep** — if the decision encodes a behavioral rule ("we always do X" / "we never do Y"), propose a one-line addition to `CLAUDE.md` / `AGENTS.md` per the CLAUDE.md debrief rules in `/flow:done` step 8 (host-appropriate file, ≤ 5 lines). Purely architectural choices ("Postgres over MySQL") are not instruction-file rules.

6. **Cross-link and maintain** — back-link the DDR from the active plan and the implementing commit. When a new DDR contradicts an old one, mark the old `Status: Superseded by DDR-<NNN>`, link forward, never delete (the trail matters).

7. **Report** — _"DDR-<NNN> recorded. Link it in the active plan / commit message."_
