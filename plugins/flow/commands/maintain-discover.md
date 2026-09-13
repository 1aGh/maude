---
name: maintain-discover
category: maintain
type: command
description: "Find skills, agents and other capabilities for a task description."
keywords: [search, find, discover, capability, command, agent, skill, prompt]
argument-hint: What task are you trying to accomplish?
---

# Discover AI Capabilities

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Search the AI capability registry to find the right command, agent, skill, or prompt for any task.

## Input

The user provides a natural-language query describing what they want to accomplish.
If no query is provided, ask: **"What task are you trying to accomplish?"**

## Process

1. **Read the manifest.** Load `.ai/manifest.json` and parse the `assets` array.
2. **Score each asset.** For every asset, compute a relevance score by checking how many of the user's query terms (case-insensitive) match against:
   - `name` (weight: 2×)
   - `description` (weight: 2×)
   - `keywords` (weight: 3× — most specific signal)
   - `capabilities` (weight: 1×)
   - `domains` (weight: 1×)
     Also give partial credit for substring matches (e.g., query "test" matches keyword "testing").
3. **Rank and filter.** Sort by score descending. Keep the top 5–10 results (anything with score > 0).
4. **Select "Did you know?" tips.** From assets that scored 0 or very low, pick 2–3 lesser-known but useful capabilities to highlight. Prefer skills and prompts since users often forget those exist.

## Output

Produce a report in this exact format:

```markdown
## Discovery Results for: "<query>"

| Rank | Asset    | Type   | Description   |
| ---- | -------- | ------ | ------------- |
| 1    | `<name>` | <type> | <description> |
| 2    | `<name>` | <type> | <description> |
| ...  | ...      | ...    | ...           |

### How to use the top result

<Brief explanation of how to invoke the #1 result — e.g., "Run `/ai/commit` or say 'follow .claude/commands/commit.md'">

### 💡 Did you know?

- The `<skill-name>` skill can <one-line description>
- Use `#<prompt-name>` in Copilot Chat to <one-line description>
- The `<command-name>` command <one-line description>
```

## Rules

- If the manifest file doesn't exist, output:
  > ⚠️ Manifest not found. Run the manifest generation script to generate it.
- Always include the "Did you know?" section, even if the main results are strong.
- Never fabricate assets — only report what exists in the manifest.
- If no assets match (all scores = 0), say "No matching capabilities found" and show 3–5 suggestions from the full asset list that might be close.
- Keep the output concise — the table plus tips should fit in one screen.
