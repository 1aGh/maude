---
name: debugging-rules
description: "Debug from evidence and root cause through hypothesis, fix and verification; stop repeated speculative fixes."
user-invocable: false
---

# debugging-rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Find root cause before fixing. Gather evidence, reproduce, compare working paths, test a concrete hypothesis, then make and verify the smallest justified fix. Follow the four-phase procedure; repeated failed fixes trigger the architectural stop instead of another guess. Do not claim success without verification or mistake environmental evidence for product behavior.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| When performing this stage: Iron Law | [Iron Law](./_guide-01-iron-law.md) |
| When performing this stage: When to apply | [When to apply](./_guide-02-when-to-apply.md) |
| For every debugging investigation | [Four phases](./_guide-03-four-phases.md) |
| When performing this stage: Integration with the workflow | [Integration with the workflow](./_guide-04-integration-with-the-workflow.md) |
| When performing this stage: Red flags — STOP and follow process | [Red flags — STOP and follow process](./_guide-05-red-flags-stop-and-follow-process.md) |
| When performing this stage: User signals you're doing it wrong | [User signals you're doing it wrong](./_guide-06-user-signals-you-re-doing-it-wrong.md) |
| When performing this stage: Common rationalizations | [Common rationalizations](./_guide-07-common-rationalizations.md) |
| When performing this stage: When investigation reveals "no root cause" | [When investigation reveals "no root cause"](./_guide-08-when-investigation-reveals-no-root-cause.md) |
| When performing this stage: Quick reference | [Quick reference](./_guide-09-quick-reference.md) |
| When performing this stage: Real-world impact | [Real-world impact](./_guide-10-real-world-impact.md) |
| When performing this stage: Related | [Related](./_guide-11-related.md) |
