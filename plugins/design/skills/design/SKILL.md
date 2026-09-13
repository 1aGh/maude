---
name: design
description: "Design or edit Maude canvases using the project design system, snapshots, screenshots and specialist critique."
---

# design

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Use the target project's `.design/config.json` and active canvas state. Preserve the design-system envelope and accessibility at every opt-out scope. Snapshot before mutation, edit in place, verify the rendered result, and retain the configured critic loop, stop conditions, metadata, transcript and documentation updates. Match the user's language. Do not load generation, whiteboard or critic recipes for a task that does not use them.

## Read only the relevant procedure

The references below retain the complete procedure. Read the entry for the stage
before performing it; conditional examples, setup and troubleshooting load only
when needed. A staged workflow follows its applicable stages in order, including
verification and close-out. References to another section mean the matching row
here, not permission to skip that requirement. Do not read all references at once.

| When | Read |
| --- | --- |
| Initial orientation, prerequisites and scope | [Overview](./_guide-00-overview.md) |
| Before resolving design-system scope or fidelity | [Opt-out scope — palette / aesthetic / full](./_guide-01-opt-out-scope-palette-aesthetic-full.md) |
| Before any canvas mutation | [Hard contract — non-negotiable](./_guide-02-hard-contract-non-negotiable.md) |
| When starting any design command | [Server lifecycle — every command starts here](./_guide-03-server-lifecycle-every-command-starts-here.md) |
| When resolving the active canvas or selection | [Active state schema](./_guide-04-active-state-schema.md) |
| When reading or resolving pinned comments | [Comments — element-pinned annotations](./_guide-05-comments-element-pinned-annotations.md) |
| When reading or writing board annotations | [Strokes annotation layer — AI read/write surface (FigJam v3 + v4)](./_guide-06-strokes-annotation-layer-ai-read-write-surface-figjam-v.md) |
| Before edits or rollback | [Snapshot protocol](./_guide-07-snapshot-protocol.md) |
| When selecting a canvas operation | [Command routing](./_guide-08-command-routing.md) |
| Before selecting or running critics | [Critic panel routing — orchestrator decides](./_guide-09-critic-panel-routing-orchestrator-decides.md) |
| When entering the configured automatic review loop | [Auto-critic loop — default behavior of /design:edit and /design:new](./_guide-10-auto-critic-loop-default-behavior-of-design-edit-and-de.md) |
| When choosing the corresponding schema or element types | [Stop-condition vocabulary](./_guide-11-stop-condition-vocabulary.md) |
| When performing this stage: Default thresholds | [Default thresholds](./_guide-12-default-thresholds.md) |
| When performing this stage: Algorithm | [Algorithm](./_guide-13-algorithm.md) |
| When performing this stage: Why "stable-but-bland" exists as an exit | [Why "stable-but-bland" exists as an exit](./_guide-14-why-stable-but-bland-exists-as-an-exit.md) |
| When performing this stage: Building the fix prompt | [Building the fix prompt](./_guide-15-building-the-fix-prompt.md) |
| When performing this stage: Default flow vs. `--perfect` — different defaults per command | [Default flow vs. `--perfect` — different defaults per command](./_guide-16-default-flow-vs-perfect-different-defaults-per-command.md) |
| When performing this stage: Per-canvas metadata sidecar | [Per-canvas metadata sidecar](./_guide-17-per-canvas-metadata-sidecar.md) |
| When performing this stage: Iteration transcript | [Iteration transcript](./_guide-18-iteration-transcript.md) |
| When performing this stage: Continuous docs maintenance | [Continuous docs maintenance](./_guide-19-continuous-docs-maintenance.md) |
| When performing this stage: `/design:handoff [--target <label>] [--force]` — production migration | [`/design:handoff [--target <label>] [--force]` — production migration](./_guide-20-design-handoff-target-label-force-production-migration.md) |
| When performing this stage: `/design:browse` — boot/show server | [`/design:browse` — boot/show server](./_guide-21-design-browse-boot-show-server.md) |
| Before generating a new canvas | [Generation envelope (frontend-design — for `/design:new`)](./_guide-22-generation-envelope-frontend-design-for-design-new.md) |
| When composing a generation brief | [Envelope discipline — don't over-prescribe](./_guide-23-envelope-discipline-don-t-over-prescribe.md) |
| When invoking another skill or its fallback | [Cross-skill calls](./_guide-24-cross-skill-calls.md) |
| When an operation fails | [Failure modes](./_guide-25-failure-modes.md) |
| Before choosing an implementation approach | [What NOT to do](./_guide-26-what-not-to-do.md) |
