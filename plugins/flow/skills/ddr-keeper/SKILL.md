---
name: ddr-keeper
type: skill
description: "Identify architectural decisions worth recording during implementation, review and feature completion."
keywords: [ddr, decision, architecture, trade-off, learning, memory]
---

# DDR Keeper

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

You are the project's institutional memory. Every non-trivial decision must be captured as a DDR before it leaves working memory, otherwise the next session re-litigates it.

## When to Use This Skill

- During `/plan` when an architectural fork is about to be decided
- During `/execute` when a pivot diverges from the plan
- When the user asks "should we use X or Y" and the answer matters beyond this task
- Before `/done` — sweep `## Decisions to record` in active plan and turn each into a DDR

## When a decision is DDR-worthy

A decision is DDR-worthy if any of:

- Choosing between two or more genuinely viable libraries / frameworks / patterns
- Defining shape of data model, API, auth flow, permission model, schema
- Saying "no" to something the PRD seems to imply
- Performance / DX / cost trade-off where opposite choice is defensible
- Deprecating or replacing an existing approach
- A pivot during `/execute` that diverges from the plan
- Convention for a new pattern that other features will copy
- Choosing a changelog provider (e.g. switching from Changesets to git-cliff) — `integrations.changelog.provider` affects every contributor's release workflow; record the trade-off and the **Revisit when** trigger

## When a decision is NOT DDR-worthy

- Mechanical rename, format, lint fix
- Follows directly from `.ai/<project>-prd.md` or `.ai/<project>-design-system.md`
- Already covered by an existing DDR
- Local refactor with no public-API impact

## Process

1. **Recognize** — when conversation hits a DDR-worthy moment, pause and explicitly say so: _"This is DDR-worthy — let's capture it before we move on."_
2. **Run `/flow:record-ddr <titulek>`** — the slash command handles file naming, numbering, index update.
3. **Insist on quality** — when filling the DDR template, refuse weak content:
   - At least 2 alternatives in `Alternatives considered` (even if one is "do nothing")
   - `Consequences` split into positive and negative (every decision has both)
   - `Revisit when` — a concrete trigger condition for re-evaluation, not "if we have problems"
4. **Canvas reference (UI-affecting DDRs)** — see below.
5. **Cross-link** — back-link DDR from active plan and from commit message that implements it.
6. **Index** — where the index lives depends on the backend (`maude kg resolve --json`; contract in **`flow:kgai-backend`**):
   - **graph inactive** (default) → append to the decisions README, resolved as `.ai/archive/decisions/README.md` when that directory exists, else `.ai/decisions/README.md`. A repo that has migrated moves its DDR prose under `.ai/archive/`, and appending to the old path silently recreates a second, half-empty index beside the real one.
   - **graph active** → **there is no README to append to.** The graph *is* the index: `maude kg search "<topic>"` answers what the README was for, and `/flow:record-ddr` already ingested the decision with its `SUPERSEDES`/`EXTENDS`/`REFERENCES` edges. Maintaining a parallel markdown index just gives the next reader two sources that disagree.

## Canvas reference for UI-affecting decisions

A decision about how something *looks or behaves* should point at the canvas that embodies it — otherwise the next reader has the rationale but not the pixels.

**Heuristic — trigger the prompt when both hold:**

1. The DDR title or context contains a UI keyword: `UI`, `UX`, `layout`, `color`, `colour`, `typography`, `font`, `spacing`, `interaction`, `animation`, `motion`, `component`, `icon`, `theme`, `density`, `responsive`, `accessibility`/`a11y` *applied to a visual surface*.
2. The project uses the design plugin (`<designRoot>` exists — resolve `paths.designRoot`, default `.design`).

**When triggered**, ask once: _"This decision touches UI. Does it reference a specific canvas? [Type a `.design/...` path or N]"_

- **A path** → validate it exists. If it does, record it as the `**Related canvas:**` header line in the DDR (the design-plugin equivalent of the existing `**Tags:**` line — DDRs use `**Field:**` header lines, not YAML frontmatter). If the path doesn't resolve, **warn** (`"⚠ <path> not found — recording anyway; create or fix the link later"`) and record it regardless — the canvas may be authored after the decision.
- **N** → omit the `**Related canvas:**` line entirely. Don't nag; many UI decisions legitimately predate any canvas.

Skip the prompt silently when either condition fails (non-UI DDR, or no design plugin) — it must not add friction to backend/infra DDRs.

## Anti-patterns

- ❌ Writing a DDR after the fact for cosmetic reasons. DDRs capture genuine debate, not rationalization.
- ❌ Listing one alternative ("we'll use X"). If there's no alternative considered, it's a default, not a decision.
- ❌ Vague consequences ("will improve maintainability"). Concrete trade-offs only.
- ❌ Skipping `Revisit when`. Every decision is contingent on context that will change.

## Maintenance

When a previous DDR is contradicted by a new one:

1. Mark the old one `Status: Superseded by DDR-<NNN>`
2. Link forward to the new DDR
3. Never delete superseded DDRs — they're the trail of how we got here

## Integration with other commands

- `/plan` — when generating the plan, populate `## Decisions to record` for any DDR-worthy fork. Don't write the DDR yet — just flag.
- `/execute` — if a pivot from the plan happens, halt and run `/flow:record-ddr` before continuing.
- `/done` — sweep `## Decisions to record`. Every unrecorded item must become a DDR before commit.
- `/flow:record-retro` — after a feature ships, look for repeated decisions that should be promoted to DDR rules.
