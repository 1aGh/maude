## Project-specific notes

Add project-specific security rules here as the codebase surfaces them. Examples that often grow over time:

- Domain-specific PII fields (e.g. medical record numbers, learner IDs) and their redaction patterns
- Project-specific MCP allowlist (which servers are vetted for this codebase)
- Project-specific allowlisted outbound hosts
- Per-feature destructive-action lists requiring user ack
- Project trust-boundary diagram pointer (where untrusted content enters, where privileged actions land)

When a new pattern recurs in three findings, promote it from `notes` to a numbered rule above.
