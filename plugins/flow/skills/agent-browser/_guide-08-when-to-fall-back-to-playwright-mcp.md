## When to fall back to Playwright MCP

Rare. Use Playwright only when:

- agent-browser daemon won't start (after `doctor --fix` fails)
- You need a one-shot screenshot embedded inline immediately (Playwright auto-embeds, agent-browser saves to file)
- You're outside this project where the profile env isn't set

Otherwise: agent-browser is the default, period.

---
