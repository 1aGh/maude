---
name: scenario
description: "Author or run cross-platform UI scenarios with selectors, screenshots, platform coverage and result reports."
allowed-tools: Bash(agent-browser:*), Bash(agent-device:*), Bash(xcrun simctl:*), Bash(adb:*)
hidden: true
---

# scenario

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Read any repo-owned scenario guide and resolve the platform matrix first. Preserve all requested platforms, stable selectors, screenshot proof and the report. Mark infrastructure errors separately from product failures; a skipped or unavailable platform is not a passing check. Use the run procedure for existing scenarios and authoring rules when creating one.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| When performing this stage: Repo-owned scenario guide (optional overrides) | [Repo-owned scenario guide (optional overrides)](./_guide-01-repo-owned-scenario-guide-optional-overrides.md) |
| When performing this stage: Platform matrix | [Platform matrix](./_guide-02-platform-matrix.md) |
| When performing this stage: File layout | [File layout](./_guide-03-file-layout.md) |
| When performing this stage: Step shape | [Step shape](./_guide-04-step-shape.md) |
| When performing this stage: Infra-error vs product-fail classification | [Infra-error vs product-fail classification](./_guide-05-infra-error-vs-product-fail-classification.md) |
| When performing this stage: Selectors — the right reach order (proven) | [Selectors — the right reach order (proven)](./_guide-06-selectors-the-right-reach-order-proven.md) |
| When performing this stage: Shareable mobile-UX scenario body | [Shareable mobile-UX scenario body](./_guide-07-shareable-mobile-ux-scenario-body.md) |
| When performing this stage: Parallelization rule | [Parallelization rule](./_guide-08-parallelization-rule.md) |
| When performing this stage: Phase C speed levers — covers manifest, skip, background boot, web-only (DDR-061) | [Phase C speed levers — covers manifest, skip, background boot, web-only (DDR-061)](./_guide-09-phase-c-speed-levers-covers-manifest-skip-background-bo.md) |
| When executing an existing scenario | [Running an existing scenario](./_guide-10-running-an-existing-scenario.md) |
| Before reporting results or handing off | [Report shape (deliverable)](./_guide-11-report-shape-deliverable.md) |
| Before login, session reuse or authentication changes | [Authoring a new scenario](./_guide-12-authoring-a-new-scenario.md) |
| When checking known limitations; not implemented behavior | [TODO (not yet implemented)](./_guide-13-todo-not-yet-implemented.md) |
| When performing this stage: Codebase blockers (file as tickets to unblock automation) | [Codebase blockers (file as tickets to unblock automation)](./_guide-14-codebase-blockers-file-as-tickets-to-unblock-automation.md) |
