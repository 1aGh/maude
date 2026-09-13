---
name: agent-device
description: "Automate native mobile apps with agent-device: simulator setup, selectors, screenshots and scenario execution."
allowed-tools: Bash(agent-device:*), Bash(npx agent-device:*), Bash(xcrun simctl:*)
hidden: true
---

# agent-device

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Use the project device/bundle configuration, stable selectors and compact snapshots. Keep per-device sessions and artifacts isolated. Use screenshot evidence and the documented platform workaround when needed; classify unavailable infrastructure separately from product failures. Read setup only on an unconfigured machine and platform-specific recipes only for that target.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| Only for a new or unconfigured machine | [First-time setup (new machine)](./_guide-01-first-time-setup-new-machine.md) |
| When performing this stage: Day-to-day rules | [Day-to-day rules](./_guide-02-day-to-day-rules.md) |
| When performing this stage: The core loop | [The core loop](./_guide-03-the-core-loop.md) |
| Before login, session reuse or authentication changes | [Auth state — already persistent](./_guide-04-auth-state-already-persistent.md) |
| When the task needs a worked implementation example | [Recipes](./_guide-05-recipes.md) |
| When performing this stage: Token efficiency cheat-sheet | [Token efficiency cheat-sheet](./_guide-06-token-efficiency-cheat-sheet.md) |
| When performing this stage: Snapshot reading guide | [Snapshot reading guide](./_guide-07-snapshot-reading-guide.md) |
| When performing this stage: Selectors | [Selectors](./_guide-08-selectors.md) |
| When diagnosing the corresponding failure | [Troubleshooting](./_guide-09-troubleshooting.md) |
| When performing this stage: When NOT to use agent-device | [When NOT to use agent-device](./_guide-10-when-not-to-use-agent-device.md) |
| When performing this stage: Reference | [Reference](./_guide-11-reference.md) |
