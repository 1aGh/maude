---
name: new
category: daily
description: "Create a canvas with several artboards, an empty brief canvas, or artboards from annotations; verify with the critic loop."
argument-hint: "<Name> \"<brief>\" [--blank] [--from-annotations] [--fresh] [--component] [--mobile] [--quick | --no-critic] [--perfect-iter N] [--opt-out=palette|aesthetic|full] [--ds=<name>]"
---

# /design:new

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Resolve normal / blank / annotation-ingest mode first. A new canvas is made by
the same create the app uses for ⌘N (so its name, folder, design system and
`.meta.json` match what the person would get), then its artboards are drafted
into it one at a time: every artboard empty first with its kind and size
(App · Web page · Social · Print · Video, from the preset catalogue), then big
before small, words last. The design plugin's hooks keep the bytes before every
write and make the whole draft one run, one version and one undo step. Preserve
the multi-artboard wrapper, design-system selection, opt-out scope and
accessibility. `new` keeps its existing default perfect loop (8 iterations,
aspiration target 4.5), with critics spawned on hand-offs as `/design:critic`
does; `--quick`, `--no-critic` and other documented flags select their existing
branches. Blank mode skips generation and critics exactly as the mode procedure
specifies. Text you write for the person follows skill `contract-voice`.

## Procedure index

Read the overview, inputs/defaults and mode rules first. Then follow applicable
numbered stages in order, reading each linked stage **before** acting. Preserve
all prerequisites, branches, checkpoints and final reporting. A branch that says
exit skips subsequent stages; otherwise continue. Load only the needed stage,
not every example or branch at once. Cross-references to step numbers or section
titles refer to this index. Plugin-relative examples retain their original
`commands/new.md` context; project paths still resolve in the target repo.

| Order | Stage |
| --- | --- |
| 0 | [Overview](../references/new/00-overview.md) |
| 1 | [Default = `--perfect`](../references/new/01-default-perfect.md) |
| 2 | [Modes: normal · blank · ingest (Phase 22)](../references/new/02-modes-normal-blank-ingest-phase-22.md) |
| 3 | [Procedure](../references/new/03-procedure.md) |
| 4 | [0. Pre-flight: bootstrap detection](../references/new/04-0-pre-flight-bootstrap-detection.md) |
| 5 | [1. Resolve config + DS](../references/new/05-1-resolve-config-ds.md) |
| 6 | [1.5 Cache the DS-context pack (Phase C / DDR-061)](../references/new/06-1-5-cache-the-ds-context-pack-phase-c-ddr-061.md) |
| 7 | [1.6 Resolve mode (normal · blank · ingest)](../references/new/07-1-6-resolve-mode-normal-blank-ingest.md) |
| 8 | [2. Server lifecycle check + runtime-bundle health probe](../references/new/08-2-server-lifecycle-check-runtime-bundle-health-probe.md) |
| 9 | [3. Name the canvas and make it](../references/new/09-3-validate-name-resolve-target-path.md) |
| 10 | [3.5. BLANK mode — make an empty brief canvas (Phase 22)](../references/new/10-3-5-blank-mode-create-an-annotation-only-brief-canvas.md) |
| 11 | [3.6. Short-circuit on identical brief (Phase C / DDR-061)](../references/new/11-3-6-short-circuit-on-identical-brief-phase-c-ddr-061.md) |
| 12 | [4. Resolve mobile/desktop + opt-out scope](../references/new/12-4-resolve-mobile-desktop-opt-out-scope.md) |
| 13 | [4.5. UX patterns research (cache-first)](../references/new/13-4-5-ux-patterns-research-cache-first.md) |
| 14 | [4.6. Artboard-count + scope pre-question (when count is ambiguous from brief)](../references/new/14-4-6-artboard-count-scope-pre-question-when-count-is-amb.md) |
| 15 | [5. Build envelope (with the artboard plan)](../references/new/15-5-build-envelope.md) |
| 16 | [6. Draft — artboard by artboard (preferred + fallback)](../references/new/16-6-generate-preferred-fallback.md) |
| 17 | [6b. INGEST mode — read annotations + insert into the active canvas (Phase 22)](../references/new/17-6b-ingest-mode-read-annotations-insert-into-the-active-canvas.md) |
| 18 | [7. Validate output](../references/new/18-7-validate-output.md) |
| 19 | [8. Write the draft into the canvas](../references/new/19-8-write-target-file.md) |
| 20 | [9. Post-write reality check — per-artboard screenshots](../references/new/20-9-post-write-reality-check-per-artboard-screenshots.md) |
| 21 | [9.5. Design-system keeper precheck](../references/new/21-9-5-design-system-keeper-precheck.md) |
| 22 | [9.6. Custom-art routing → `draw-agent` (conditional)](../references/new/22-9-6-custom-art-routing-draw-agent-conditional.md) |
| 23 | [9.7. AI-media generation pass → `maude design generate` (conditional)](../references/new/23-9-7-ai-media-generation-pass-maude-design-generate-cond.md) |
| 24 | [10. Auto-critic + auto-fix loop (default = `--perfect`)](../references/new/24-10-auto-critic-auto-fix-loop-default-perfect.md) |
| 25 | [11. Bootstrap docs](../references/new/25-11-bootstrap-docs.md) |
| 26 | [11.5. Record the canvas decision (kgai — when active)](../references/new/26-11-5-record-the-canvas-decision-kgai-when-active.md) |
| 27 | [12. Print](../references/new/27-12-print.md) |
| 28 | [What `/design:new` does NOT do](../references/new/28-what-design-new-does-not-do.md) |
| 29 | [Failure modes](../references/new/29-failure-modes.md) |
