# skill-loader — resolution strategy

> Loaded on demand (from `SKILL.md` Step 3) when there's a real gap to resolve. The priority ladder, the `terminal-skills` MCP recipe, the MCP-vs-WebFetch fallback tree, anti-patterns, and troubleshooting live here so they don't weigh on every plan/init turn.

## Resolution Priority

Always try in this order. Stop at the first that fits.

1. **Built-in / plugin skill already loaded.** Check the active host's installed skill catalog for a match. Examples: `pixijs-skills:*` for PixiJS, `design:design-system` for design tokens, `frontend-design:frontend-design` for production-grade UI. If a skill with the matching domain is listed, read its entry (unless already loaded in this session), then use it — do not pull a duplicate from `terminal-skills`.
2. **Matching subagent.** Inspect available agents. If an agent's description matches the task (e.g. `flow:a11y-auditor` for a11y work, `claude-code-guide` for Claude Code API/SDK), delegate to it instead of asking for a generic skill.
3. **`terminal-skills` MCP catalogue.** Search by library name + role keywords (below). Load the best match with `mcp__terminal-skills__get_skill`.
4. **Web docs as fallback.** If nothing in the MCP catalogue matches, use `WebFetch` against the library's official docs URL — never invent API surface.

## Resolve each gap via `terminal-skills`

For each gap:

```
mcp__terminal-skills__search_skills(query: "<lib-name> <role>")
```

Example queries: `"yjs CRDT"`, `"drizzle ORM schema"`, `"hono router middleware"`, `"effect typescript runtime"`.

Inspect results, pick the best match (most specific, highest signal in description), then:

```
mcp__terminal-skills__get_skill(name_or_id)
```

If `search_skills` returns nothing, try `list_categories` to browse — the library might be under a parent topic (e.g. `realtime`, `database`, `state-management`).

## Anti-patterns

- ❌ Calling `mcp__terminal-skills__get_skill` for a library that already has a loaded built-in skill.
- ❌ Resolving micro-utilities (`lodash`, `dotenv`, `classnames`). They are too small to need a skill.
- ❌ Loading 10 skills "just in case". Load only what the current task touches.
- ❌ Treating this skill's output as code-changing — it only routes/records, never edits source.
- ❌ Inventing API surface when `terminal-skills` returns nothing — fall back to `WebFetch` on official docs.

## Troubleshooting

| Symptom                                              | Resolution                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `terminal-skills` tool unavailable                   | Confirm MCP server connection. Fall back to WebFetch on the library's official docs.                       |
| `search_skills` returns empty                        | Try broader keywords or `list_categories`; if still nothing, fall back to WebFetch.                        |
| Multiple competing matches                           | Prefer the one whose description names the specific API surface you need (e.g. _yjs awareness_ vs _yjs core_). |
| Skill loaded but feels generic                       | Combine with WebFetch on official docs for current version specifics.                                     |
| Same library keeps getting re-resolved every session | Ensure Step 4 wrote the reference memory / STATE.md block. Check it is being read at session start.        |

## References

- `mcp__terminal-skills__search_skills` — keyword search across the MCP catalogue.
- `mcp__terminal-skills__list_categories` — browse by domain when keyword search misses.
- `mcp__terminal-skills__get_skill` — load the chosen skill's content into the session.
- `plugins/flow/skills/codebase-intelligence/` — companion skill that produces the codebase map this skill diffs against.
- `plugins/flow/skills/make-skill-template/` — use when a resolved gap deserves a **permanent** local skill, not a one-off MCP fetch.
