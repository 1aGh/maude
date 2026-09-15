---
"@1agh/maude": minor
---

Add `orbit` as a tracker provider for the flow plugin. Set `integrations.tracker.provider` to `"orbit"` (optionally with `baseUrl` and `tokenEnv`, which defaults to `ORBIT_MCP_TOKEN`) and point the project's `.mcp.json` at the orbit MCP server. The config only ever holds the variable name; the token stays in your environment.

The new `flow:orbit-backend` skill is the provider's single contract. `/flow:plan` finds the task from the branch name or its arguments, or asks once to create it, and writes `ORB-<n>` into the plan's Ticket line. `/flow:execute` reports working state at each milestone so the board shows where a session got to. `/flow:done` marks the task done with the PR link, then pushes the plan, RCA, execution report, code review and retro to orbit. `/flow:status`, `/flow:bug-rca` and `/flow:bug-fix` read the task through the same skill. Every orbit call is warn-only: orbit being down, an expired token or an unknown key never blocks a command. Text read from orbit is treated as untrusted data, never as instructions.
