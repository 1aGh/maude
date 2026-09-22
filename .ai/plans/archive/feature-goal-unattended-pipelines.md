---
name: feature-goal-unattended-pipelines
status: rejected
created: 2026-07-15
closed: 2026-09-22
decisions:
  - Rejected as an unimplemented, stale integration plan rather than reported as done.
  - Any future goal integration must be replanned against current cross-host goal APIs, bare-slug plugin frontmatter, and graph-native decision identity.
---

# Feature: /goal-aware unattended pipelines for flow + design commands

> **Closed as rejected/superseded on 2026-09-22.** No implementation landed:
> `goal-patterns` was never created, none of the 17 command files gained the
> proposed closing block, and workflow state never gained `Active goal`.
> The plan also reserved DDR-180 after that number had been assigned to ACP
> elicitation, and its proposed `name: flow:goal-patterns` frontmatter predates
> DDR-191's current bare-slug rule. Re-plan from current Claude Code/Codex goal
> capabilities if the product need returns; do not execute this file as written.

Validate docs and codebase patterns before implementing. Pay attention to existing naming, frontmatter, and closing-prompt conventions.

## Description

Add `/goal`-pattern guidance and cross-session continuity hooks to the most-used flow and design commands, so users can drive multi-command pipelines (plan→execute→validate→done, bug-rca→bug-fix→validate, setup-ds→new→edit, reel's ingest→analyze→direct→codegen→critic, board's read/write loop) to completion unattended — using Claude Code's native `/goal` mechanism (a session-scoped Stop-hook evaluator) instead of the user manually re-prompting between each command.

## User Story

As a Maude user driving a feature end-to-end (or a bug fix, or a design iteration, or a video reel cut), I want each pipeline's commands to tell me the right `/goal` condition to set, so I can kick off the whole pipeline once and have Claude keep working — across as many top-level turns as needed — until the condition holds, without me manually typing the next command after every stage.

## Problem

Today, chaining flow/design pipelines is manual: each command ends with an explicit `Ready to X?` prompt (`plan.md`, `bug-rca.md`, `critic.md`, …) that requires the human to type the next command by hand. There's no discoverable, standard way to say "run this whole pipeline to completion, unattended."

Claude Code's `/goal` mechanism (≥ v2.1.139) already solves exactly this at the session level: it sets a completion condition, and after every top-level turn a fast evaluator model checks the transcript and either starts a new turn or clears the goal. But nothing in the flow/design plugins surfaces it — and it can't simply be "wired in" the way other config-gated features are, because of a hard constraint confirmed during planning: **`/goal` is user/CLI-typed only** (or passed via `claude -p "/goal ..."` headlessly). There is no `SlashCommand`-style tool exposed to the model that would let a command's own markdown instructions arm a goal programmatically mid-run (checked via `ToolSearch` — none found; no precedent anywhere in this repo either). So this has to be taught to the user via each command's own copy, not injected as new runtime behavior.

Separately, `/goal` state is session-scoped — lost on `/clear`, restored only via `--resume`/`--continue` of the *same* session. This repo already has its own cross-session continuity layer (`HANDOFF.md`/`STATE.md`, written by `/flow:pause`, read by `/flow:resume`) for a *different* agent or a *later* session to pick up work. Today that layer has no concept of "a goal was driving this" — a resumer has no way to know what condition to re-arm.

## Solution

1. A new shared, non-user-invocable skill, `plugins/flow/skills/goal-patterns/SKILL.md`, catalogs ready-made `/goal` condition templates for each pipeline shape. It documents `/goal`'s constraints up front (session/CLI-scoped, evaluator can't run commands or read files itself — every condition must be provable from what the target command already prints to the transcript) so every command references one source of truth instead of copies drifting.
2. Each of the 17 target command files gets its closing "next step" prompt upgraded to present the `/goal`-wrapped unattended option as a **second, clearly-labeled** choice alongside the existing single-step "Ready to X?" prompt — supervised stays the default recommendation.
3. `/flow:pause` gains an "Active goal" field in the `HANDOFF.md` template; `/flow:resume` and `/flow:status` read it back and surface "re-arm with `/goal <condition>`" as their own next step. This is the continuity bridge the user asked for — best-effort, since (per Task 1) there's no confirmed way for the model to detect a live goal's status itself.
4. DDR-180 records the integration pattern and, explicitly, its boundary: `/goal` does **not** replace or change `/flow:execute`'s Edit-Verify Loop (max 3 iterations, `execute.md:71`) or `/design:new`/`/design:edit`'s `--perfect` auto-fix loop (max 8 iterations). Those are intra-turn tool loops; `/goal` operates one level up, across top-level turns and command boundaries.

## Metadata

- **Type**: New Capability
- **Complexity**: High
- **App/Package**: `plugins/flow`, `plugins/design` (cross-cutting — root `.ai/plans/`)
- **Affected Systems**: 11 flow commands, 1 new flow skill, the `.ai/` skeleton `HANDOFF.md` template, 6 design commands, 1 new DDR, `CLAUDE.md`
- **Dependencies**: Claude Code ≥ v2.1.139 for `/goal` to exist client-side — soft dependency; all changes here are documentation/prompt copy, so on an older CLI the guidance is simply inert advice, not a broken feature

---

## Context References

### Must-Read Files

> Read these in parallel in one assistant message during `/flow:execute`.

- `plugins/flow/skills/quality-gates/SKILL.md` (full) — Why: structural model for a "shared, non-user-invocable reference skill read by many commands" (`category: shared`, `user-invocable: false`)
- `plugins/flow/skills/workflow-state/SKILL.md` (full) — Why: owns the STATE.md/HANDOFF.md schema; the new "Active goal" field must be added here, not ad-hoc in `pause.md`
- `plugins/flow/commands/plan.md` (lines ~630-660, "After Creating the Plan") — Why: the existing "Ready to execute this plan?" prompt this task extends
- `plugins/flow/commands/execute.md` (lines 71-115, 159, 187-188) — Why: the existing Edit-Verify Loop (max 3 iterations) that must NOT be touched — establishes the boundary DDR-180 records
- `plugins/flow/commands/validate.md` (closing block + lines 163-175) — Why: retry semantics, the natural `/goal` condition target
- `plugins/flow/commands/done.md` (tail) — Why: pipeline terminus; its own success report is what the plan→…→done condition must be provable from
- `plugins/flow/commands/quick.md` (closing block) — Why: fast-path pipeline needs its own, shorter condition template
- `plugins/flow/commands/utils-verify.md` (closing block) — Why: per-task sub-step, not a goal target itself — should point at execute's template, not duplicate one
- `plugins/flow/commands/bug-rca.md` (tail — "Ready to implement the fix?") — Why: prompt to extend
- `plugins/flow/commands/bug-fix.md` (tail — commit/push/PR/tracker-sync steps) — Why: pipeline terminus for the bug workflow
- `plugins/flow/commands/pause.md` (full) — Why: writes HANDOFF.md; gains the Active-goal field
- `plugins/flow/commands/resume.md` (tail + "Graceful Degradation" table) — Why: reads HANDOFF.md back; gains the re-arm suggestion
- `plugins/flow/commands/status.md` — Why: overview surface, same re-arm suggestion when relevant
- `plugins/flow/templates/ai-skeleton/templates/HANDOFF.md` (full, 33 lines) — Why: template gets a new `## Active goal` section
- `plugins/design/commands/new.md` (lines 16-21, 989-1031, tail report block) — Why: existing `--perfect` loop boundary + closing report block to extend
- `plugins/design/commands/edit.md` (lines 591-635, tail report block) — Why: existing `--perfect [N]` loop boundary + closing block
- `plugins/design/commands/critic.md` (line 142, tail) — Why: "…or `/design:edit "..." --perfect` to auto-fix in a loop" suggestion gets the goal-wrapped alternative
- `plugins/design/commands/setup-ds.md` (closing/post-scaffold block) — Why: pipeline start (setup-ds → new → edit)
- `plugins/design/commands/board.md` (tail — "Output report") — Why: template-fill condition target
- `plugins/design/commands/reel.md` (Step 6 — Report) — Why: ingest→analyze→direct→codegen→critic condition target
- `plugins/flow/CATEGORIES.md`, `plugins/design/CATEGORIES.md` — Why: naming/frontmatter conventions (DDR-004, DDR-006) the new skill file and any touched frontmatter must follow
- `.ai/archive/decisions/README.md` (DDR index) — Why: at plan time, DDR-178 and DDR-179 are already claimed (one committed, one staged by a concurrent in-progress change) — confirms the next free number is DDR-180; re-check immediately before committing, DDR numbers race on shared `main`

### Files to Create

- `plugins/flow/skills/goal-patterns/SKILL.md` — the condition-template catalog
- `.ai/archive/decisions/DDR-180-goal-mechanism-integration-for-unattended-pipelines.md` — the decision record

### Documentation

- [`/goal` docs](https://code.claude.com/docs/en/goal.md) — Why: canonical spec for `/goal` semantics, evaluator behavior, and the constraints this plan is built around (already fetched and summarized in this plan's Problem section)

### Patterns to Follow

Skill frontmatter (from `quality-gates/SKILL.md`):

```
---
name: flow:goal-patterns
category: shared
description: <when a command should reference this — condition templates for unattended /goal-driven pipelines>
user-invocable: false
---
```

Closing-prompt pattern (from `plan.md`): a single blockquote question after the report block. Extend to present **two** options (supervised default, `/goal`-unattended alternative) — never replace the supervised prompt outright.

---

## Tasks

Execute in order. Each task is atomic and testable.

### Task 1: RESEARCH — confirm goal-state visibility + re-verify the no-programmatic-invocation constraint

- **Do**: Before writing any command copy that claims to "detect" an active goal, verify (a) whether an active `/goal`'s condition/status is exposed anywhere in the model's own context (system reminders, env info — the way `gitStatus`/`userEmail` are injected in this session), or whether it's purely a CLI-side indicator (`◎ /goal active`) invisible to the model; (b) re-confirm there's no `SlashCommand`-style tool that would let a command's own instructions arm a goal programmatically (already checked via `ToolSearch("slash command invoke goal")` during planning — none found; re-verify at execute time in case the harness changed).
- **Pattern**: The `ToolSearch` check already run during planning of this feature.
- **Gotcha**: If goal-state turns out to be visible to the model, Tasks 8-9 (pause/resume bridge) can auto-populate the "Active goal" field instead of asking the user — don't assume either way, verify first, and adjust Task 8's wording accordingly before writing it.
- **Validate**: Manual — no automated check available (no test suite in this repo). Record the finding as a one-paragraph note at the top of the new skill file (Task 2) and in DDR-180 (Task 10).

### Task 2: CREATE the goal-patterns skill

- **Do**: Write `plugins/flow/skills/goal-patterns/SKILL.md` with frontmatter `name: flow:goal-patterns`, `category: shared`, `user-invocable: false`. Body: (1) Task 1's finding + the hard constraint explainer; (2) a condition-template table, one row per pipeline shape:
  - `plan → execute → validate → done`: `/flow:execute <plan-path> completes all tasks, /flow:validate passes with 0 blockers, and /flow:done has committed + opened a PR — or stop after 40 turns`
  - `bug-rca → bug-fix → validate`: `/flow:bug-fix <ticket> is committed and /flow:validate passes with 0 blockers — or stop after 20 turns`
  - `quick` fast-path: `the change is committed and /flow:utils-verify passes — or stop after 10 turns`
  - `setup-ds → new → edit` (design bootstrap + first canvas): `the design system is bootstrapped and the first canvas scores ≥ 4.0 aspiration with 0 blockers — or stop after 25 turns`
  - `new` / `edit --perfect` refinement beyond the built-in loop: `the critic panel reports 0 blockers and aspiration ≥ 4.5 across the designated canvas(es) — or stop after 30 turns`
  - `reel`: `every ingested clip has a footage-analysis sidecar, the EDL is generated, the comp canvas renders clean at runtime-health, and motion-critic + design-critic report 0 blockers — or stop after 20 turns`
  - `board`: `the requested template/annotations are fully written to the board and the reality-check screenshot shows no overlap — or stop after 10 turns`
  (3) a short "how to use" snippet showing the literal `/goal ...` text the user types, pairable with [auto mode](https://code.claude.com/docs/en/auto-mode-config) so tool calls don't also need per-call approval.
- **Pattern**: `quality-gates/SKILL.md` — data-shape reference, not a runner.
- **Gotcha**: Every condition must be provable from transcript output only — the evaluator "does not call tools." Phrase each as something the target command's own prior output (a report block, an exit code, a printed score) already demonstrates.
- **Validate**: Manual read-through — every condition maps to a report/output block the referenced command already produces (cross-check against the "Must-Read Files" tail sections above).

### Task 3: UPDATE `plugins/flow/commands/plan.md` closing block

- **Do**: After the existing `Ready to execute this plan?` prompt, add a second option pointing at `flow:goal-patterns`' plan→execute→validate→done template, filled in with this plan's path. Reference the skill by name — don't inline the condition text (single source of truth).
- **Gotcha**: Keep supervised as the first/default option — a fresh plan can be wrong, and this repo's convention is to verify before trusting an unattended loop.
- **Validate**: Manual read.

### Task 4: UPDATE `plugins/flow/commands/execute.md` closing block

- **Do**: Add a short "Unattended" note near the final report pointing at the plan→execute→validate→done template, explicitly stating it does not change the per-task Edit-Verify Loop's 3-iteration cap (link to that section by name).
- **Validate**: Manual read.

### Task 5: UPDATE `plugins/flow/commands/validate.md`, `done.md`, `quick.md`, `utils-verify.md` closing blocks

- **Do**: `validate.md` and `done.md` point at the shared plan-pipeline template (same target condition, different vantage point). `quick.md` points at its own fast-path template. `utils-verify.md` gets a one-line note that it's a sub-step of execute's loop, not its own goal target — point at execute's entry instead of duplicating.
- **Validate**: Manual read.

### Task 6: UPDATE `plugins/flow/commands/bug-rca.md` and `bug-fix.md` closing blocks

- **Do**: `bug-rca.md`'s `Ready to implement the fix?` prompt gets the bug-rca→bug-fix→validate template as a second option. `bug-fix.md`'s final "Committed. Ready to push and create a PR?" gets a shorter pointer covering just the remaining push/PR/tracker-sync steps.
- **Validate**: Manual read.

### Task 7: UPDATE design commands (`new.md`, `edit.md`, `critic.md`, `setup-ds.md`, `board.md`, `reel.md`) closing blocks

- **Do**: Mirror Tasks 3-6's treatment: `setup-ds.md`'s post-scaffold block gets the setup-ds→new→edit template; `new.md`/`edit.md`'s final report gets the refinement-beyond-`--perfect` template, explicitly scoped as "beyond the built-in N-iteration loop" (not replacing it); `critic.md`'s existing `--perfect` fix-loop suggestion gets the goal-wrapped alternative alongside it; `board.md` and `reel.md` get their own templates from Task 2.
- **Gotcha**: Design commands stay self-contained (CLAUDE.md: "the plugin's own docs are authoritative … do not rely on summaries"). Before deciding whether design commands reference `flow:goal-patterns` directly or carry a small design-local copy of the relevant rows, grep the repo for any existing precedent of a `design:*` command referencing a `flow:*` skill — if none exists, default to a design-local copy (2-3 rows, not the whole catalog) rather than introducing a first-of-its-kind cross-plugin skill dependency.
- **Validate**: Manual read + the precedent grep described above, before choosing the reference-vs-copy approach.

### Task 8: UPDATE `workflow-state` skill + `HANDOFF.md` template — Active goal field

- **Do**: Add a `## Active goal` section to `plugins/flow/templates/ai-skeleton/templates/HANDOFF.md` (optional, blank-by-default: `<condition text, if a /goal is currently driving this session — or "none">`). Update `plugins/flow/skills/workflow-state/SKILL.md`'s schema section to document the new field and when to populate it, per Task 1's finding (auto-noted if visible to the model, otherwise asked of the user at `/flow:pause` time).
- **Validate**: Manual read; confirm the schema section stays internally consistent with the template file.

### Task 9: UPDATE `plugins/flow/commands/pause.md`, `resume.md`, `status.md`

- **Do**: `pause.md` writes the new HANDOFF.md field per Task 8's approach. `resume.md`'s "Graceful Degradation" restoration table gains a row for "Active goal," and its closing prompt adds "re-arm with `/goal <condition>`" whenever the field is non-empty. `status.md`'s overview surfaces the same when relevant.
- **Validate**: Manual read.

### Task 10: RECORD DDR-180

- **Do**: Write `.ai/archive/decisions/DDR-180-goal-mechanism-integration-for-unattended-pipelines.md` following the format of the most recently recorded DDR. Cover: the problem (manual cross-command re-prompting), the constraint (session-scoped, user/CLI-typed only, no tool-level invocation — Task 1's finding), the decision (condition-template skill + closing-prompt nudges + best-effort pause/resume bridge), and explicitly the non-decision (Edit-Verify Loop and `--perfect` loop stay untouched — different granularity, not superseded).
- **Gotcha**: Re-check `.ai/archive/decisions/` for a newer DDR immediately before this commit — numbers race on a shared `main` ([[project_ddr_numbering_races_on_shared_main]]).
- **Validate**: Manual read; confirm no number collision at commit time.

### Task 11: UPDATE CLAUDE.md pointer

- **Do**: Add a brief pointer (not a duplicate explainer) — one or two sentences, matching this file's existing terse-pointer style (e.g. the "Site roadmap regen" section) — linking to `flow:goal-patterns` and DDR-180.
- **Validate**: Manual read; confirm no content duplication that belongs in the skill/DDR instead.

---

## Validation

No test suite / lint config / build step in this repo (pure markdown commands/skills). Validation is manual:

1. **Frontmatter**: every touched/created file has correct `name: flow:...` / `design:...` prefixing and a `category:` matching an existing group (`goal-patterns` → `shared`).
2. **DDR collision check**: re-run immediately before the closing commit (Task 10 gotcha).
3. **Condition provability**: every `/goal` template in the skill maps to a report block the target command already emits — no condition requires the evaluator to "check" something the command doesn't already surface in its own output.
4. **Local dogfood spot-check** (per CLAUDE.md "Working on plugin internals locally"): point a marketplace install at this working tree in a scratch project, run `/flow:plan` on a trivial feature, confirm the closing block shows both options and the `/goal` text is copy-pasteable as-is without edits.
5. `flow:claude-md-keeper` pass if any CLAUDE.md convention drifted during Task 11.

---

## Scenario Coverage

Not applicable — this feature changes only command/skill markdown copy and one template file. There is no rendered UI or runtime code path to exercise; `scenario-runner` has nothing to screenshot. Manual read-through (Validation above) is the coverage mechanism instead of a scenario.

---

## Acceptance Criteria

- [ ] All 11 tasks completed
- [ ] `flow:goal-patterns` skill created, correctly categorized (`shared`, `user-invocable: false`), and its constraint note reflects Task 1's actual finding (not an assumption)
- [ ] 17 command files updated — flow: `plan`, `execute`, `validate`, `done`, `quick`, `utils-verify`, `bug-rca`, `bug-fix`, `pause`, `resume`, `status` (11); design: `new`, `edit`, `critic`, `setup-ds`, `board`, `reel` (6)
- [ ] `HANDOFF.md` template + `workflow-state` skill document the new "Active goal" field consistently
- [ ] DDR-180 recorded, no number collision with a concurrently-merged DDR
- [ ] CLAUDE.md pointer added, no duplicated explainer content
- [ ] No DDR-worthy decision left unrecorded
- [ ] Every closing-block edit keeps the existing supervised "Ready to X?" prompt as the first/default option — the `/goal` alternative is additive, never a replacement
