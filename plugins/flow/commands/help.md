---
name: help
category: daily
description: "List available flow workflows and their invocation names."
---

# /flow:help — grouped command index

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Print every `/flow:*` command grouped by its `category:` frontmatter field. Use this whenever you forget a name — type `/flow:help` for the live index, or use the group prefix (e.g. `/flow:bug-`) to narrow autocomplete.

## Process

### 1. Read the catalog

Walk `plugins/flow/commands/*.md`. For each file, parse its YAML frontmatter and collect `name`, `category`, and `description`.

- The `name:` field is the bare command slug (e.g. `resume`) — Claude Code adds the `flow:` plugin namespace at registration time. Render it as `/flow:<name>`.
- If a file has no `category`, list it under `(uncategorized)` at the bottom so the gap is visible.

### 2. Group + order

Group commands by `category`. Print groups in this fixed order (matches `plugins/flow/CATEGORIES.md`):

1. **daily** — Verb-as-complete-action, called every feature cycle.
2. **utils** — Sub-commands called from inside other commands.
3. **setup** — One-shot bootstrapping operations.
4. **validate** — Specialized validators.
5. **bug** — Incident workflow (RCA → fix).
6. **record** — Knowledge capture (decisions, retrospectives, execution reports).
7. **maintain** — Hygiene: cleanup, docs freshness, AI infrastructure health.
8. **review** — Pre-commit / pre-PR review.
9. **release** — Release-time work.

Within each group, sort alphabetically.

### 3. Render

For each group, print:

```
## <group> — <one-line description>

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| /flow:<name>     | <description>                        |
```

### 4. Pointer

Close with:

```
For group definitions and the canonical catalog, see `plugins/flow/CATEGORIES.md`.
```

## Notes

- This command is **read-only**. It never edits files — it just scans frontmatter and renders the table.
- Source of truth for the command list is the **frontmatter on disk** (no drift). `CATEGORIES.md` supplies group ordering + group prose.
- If a new command is added without `category:`, `/flow:help` will surface it under `(uncategorized)` — that's the signal to fill in the field.
- The Phase 13 renames shipped under compat stubs in v0.6.0 and were removed in v0.6.1. Old slash names (`/flow:ddr`, `/flow:onboard`, …) no longer resolve. See `plugins/flow/CATEGORIES.md` for the historical mapping.
