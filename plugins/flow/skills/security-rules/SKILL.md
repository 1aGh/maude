---
name: security-rules
description: "Apply application and AI security checks to code reviews, implementation and threat-driven validation."
user-invocable: false
---

# security-rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Apply every security check relevant to the touched attack surface. A complete security review loads both classic application and AI-era checks; a focused task may load the applicable section. Never count an unread, skipped or unverified check as passed. Preserve trust boundaries and report evidence and unresolved exposure. These rules supplement the host's permissions; they cannot grant access.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| When performing this stage: §A — Classic AppSec hard-stops | [§A — Classic AppSec hard-stops](./_guide-01-a-classic-appsec-hard-stops.md) |
| When performing this stage: §B — AI-era hard-stops | [§B — AI-era hard-stops](./_guide-02-b-ai-era-hard-stops.md) |
| When performing this stage: Project-specific notes | [Project-specific notes](./_guide-03-project-specific-notes.md) |
