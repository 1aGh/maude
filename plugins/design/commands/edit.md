---
name: edit
category: daily
description: "Apply feedback to the active canvas in place, then verify and run the configured critic loop."
argument-hint: "\"<feedback>\" [--screenshot <path>] [--perfect [N]] [--no-critic] [--no-propose] [--opt-out=palette|aesthetic|full]"
---

# /design:edit

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Resolve the active canvas, selection and requested edit type first. Snapshot
before writing; preserve the canvas wrapper, design-system scope and accessibility.
Keep the post-write screenshot and configured critic loop. Photo, board, print,
video, generation and other specialized steps run only for a matching request;
paid proactive generation still requires confirmation.

## Procedure index

Read the overview, inputs/defaults and mode rules first. Then follow applicable
numbered stages in order, reading each linked stage **before** acting. Preserve
all prerequisites, branches, checkpoints and final reporting. A branch that says
exit skips subsequent stages; otherwise continue. Load only the needed stage,
not every example or branch at once. Cross-references to step numbers or section
titles refer to this index. Plugin-relative examples retain their original
`commands/edit.md` context; project paths still resolve in the target repo.

| Order | Stage |
| --- | --- |
| 0 | [Overview](../references/edit/00-overview.md) |
| 1 | [Procedure](../references/edit/01-procedure.md) |
| 2 | [0. Pre-flight: bootstrap detection](../references/edit/02-0-pre-flight-bootstrap-detection.md) |
| 3 | [1. Resolve config](../references/edit/03-1-resolve-config.md) |
| 4 | [1.4 Untrusted-content banner on an imported canvas (DDR-216 D7)](../references/edit/04-1-4-untrusted-content-banner-on-an-imported-canvas-ddr-.md) |
| 5 | [1.5 Auto-load DS context for inline-mode canvases (Phase 3.6 Task 12c)](../references/edit/05-1-5-auto-load-ds-context-for-inline-mode-canvases-phase.md) |
| 6 | [2. Server lifecycle (always first) + runtime-bundle health probe](../references/edit/06-2-server-lifecycle-always-first-runtime-bundle-health-p.md) |
| 7 | [3. Read active canvas + selected element + open comments](../references/edit/07-3-read-active-canvas-selected-element-open-comments.md) |
| 8 | [3a. AST-aware fast-path (Phase 3.6 — TSX canvases only)](../references/edit/08-3a-ast-aware-fast-path-phase-3-6-tsx-canvases-only.md) |
| 9 | [3.5 Pre-edit context screenshot — **mandatory when any of**:](../references/edit/09-3-5-pre-edit-context-screenshot-mandatory-when-any-of.md) |
| 10 | [4. Snapshot before edit](../references/edit/10-4-snapshot-before-edit.md) |
| 11 | [4.5 AI activity banner — start (Phase 8 Task 4)](../references/edit/11-4-5-ai-activity-banner-start-phase-8-task-4.md) |
| 12 | [4.6 Custom-art routing → `draw-agent` (conditional)](../references/edit/12-4-6-custom-art-routing-draw-agent-conditional.md) |
| 13 | [4.7 AI-media routing → `maude design generate` (conditional)](../references/edit/13-4-7-ai-media-routing-maude-design-generate-conditional.md) |
| 14 | [5. Apply edit](../references/edit/14-5-apply-edit.md) |
| 15 | [6. Validate](../references/edit/15-6-validate.md) |
| 16 | [7. Post-write reality check — confirmation screenshot](../references/edit/16-7-post-write-reality-check-confirmation-screenshot.md) |
| 17 | [7.5. Design-system keeper precheck (conditional)](../references/edit/17-7-5-design-system-keeper-precheck-conditional.md) |
| 18 | [8. Auto-critic + auto-fix loop (default — opt out with `--no-critic`)](../references/edit/18-8-auto-critic-auto-fix-loop-default-opt-out-with-no-cri.md) |
| 19 | [8.5 Proactive media-gap proposal (opt-out; feature-ai-media-generation Phase 4, DDR-164)](../references/edit/19-8-5-proactive-media-gap-proposal-opt-out-feature-ai-med.md) |
| 20 | [9. Refresh docs (auto)](../references/edit/20-9-refresh-docs-auto.md) |
| 21 | [9.5. Record the edit decision (kgai — when active)](../references/edit/21-9-5-record-the-edit-decision-kgai-when-active.md) |
| 22 | [10. Tell user](../references/edit/22-10-tell-user.md) |
| 23 | [Failure modes](../references/edit/23-failure-modes.md) |
| 24 | [Tips](../references/edit/24-tips.md) |
