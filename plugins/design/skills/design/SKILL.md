---
name: design
description: "Design or edit Maude canvases using the project design system, snapshots, screenshots and specialist critique."
---

# design

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Use the target project's `.design/config.json` and active canvas state. Preserve the design-system envelope and accessibility at every opt-out scope. Edit in place (the hooks keep the earlier bytes and Version history keeps every change), verify the rendered result, and retain the configured critic loop, stop conditions, metadata, transcript and documentation updates. Match the user's language. Do not load generation, whiteboard or critic recipes for a task that does not use them.

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
| When reading or writing board annotations | [Whiteboard annotation layer — AI read/write surface](./_guide-06-strokes-annotation-layer-ai-read-write-surface-figjam-v.md) |
| Before edits, or to undo one | [Snapshot protocol](./_guide-07-snapshot-protocol.md) |
| When selecting a canvas operation, or deciding whether a sub-agent is warranted | [Command routing](./_guide-08-command-routing.md) |
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
| Before planning edits on a canvas AI may be changing, or when an edit is denied | [AI runs and busy artboards](./_guide-27-ai-runs-and-busy-artboards.md) |
| When looking at an earlier version of a canvas, going back to it, naming a version, or working with the Trash | [Versions and the Trash](./_guide-versions-and-trash.md) |
| When changing objects the way the person does (frames, order, lock, hide) | [Editing in Maude v2](./_guide-editing-v2.md) |
| For `/design:present`: order, skipped artboards, speaker notes | [Per-canvas metadata sidecar](./_guide-17-per-canvas-metadata-sidecar.md) |

## A first draft from Home

When the person's first message in a new chat is a sentence for a canvas that has no artboards yet (Home's "Ask AI for a new canvas…", or the empty project's prompt), the canvas file already exists: the server named it from the sentence and the person is looking at it. Draft it in this order, so the draft arrives piece by piece and never as a blank wait:

1. **Add every artboard empty first, with its kind and size.** One `DCArtboard` per screen or sheet, each with its `kind` and real dimensions (a poster is A4, a landing page is Desktop, Tablet and Mobile), written in one edit. The person sees the whole shape in the first second.
2. **Fill big before small.** Background and colour, then the large shapes and pictures, back to front, one artboard at a time. Never start with details.
3. **Words last.** Headlines, body copy and labels go in after the shapes, so the text lands where the layout already is.

Keep every `data-cd-id`, work inside the open canvas only, use the design system's tokens, and stop when the sentence is answered: one run, one draft. The person can take the whole draft back with ⌘Z (Undo this chat).
