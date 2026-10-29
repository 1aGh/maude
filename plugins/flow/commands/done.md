---
name: done
category: daily
description: "Validate and close a feature: decision capture, delivery, retrospective and archive within authorized scope."
argument-hint: "[--quick] [path to plan]"
---

# /done — close out a feature

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

The **final gate** after `/execute`: verification, decisions, review, commit, push, report, retro and archive in one pass.

Input: `$ARGUMENTS` — optionally `--quick` plus a plan path (default: the one in `.ai/state/STATE.md`).

**`--quick` trims Step 1 only** (`/flow:validate --fast` instead of the full run). Steps 2–9 are unchanged — acceptance, DDRs, review, tracking and retro are what `--quick` never cuts. Use it for routine closes where a full `/flow:validate` runs before merge to main; never for auth, migrations, cross-package, CI config or security-sensitive work (the `/flow:execute --quick` guardrail list).

## Process

### 1. Validate (hard gate)

- **Default:** run `/flow:validate` (static gates, tests, build, cross-platform scenario, a11y, design consistency, decision drift). Gate: scenario report `blockers == 0` AND `parity_ok == true` (or a DDR explaining intentional divergence). Quality gates (`config.quality.*`) run inside validate — never invoke them twice (`flow:quality-gates`).
- **`--quick`:** run `/flow:validate --fast` (static gates + affected tests; no build, scenario, a11y or design-system check). Security review is NOT skipped — it runs in Step 4. Record the skipped gates in the report.

Any failure → stop, return to `/execute`, then run `/done` again.

### 2. Acceptance criteria check

Walk `## Acceptance Criteria` in the plan; check off or flag each: all tasks completed · validate passes (under `--quick`: static + affected tests, note the deferred full validate in STATE.md) · no DDR-worthy decision unrecorded · scenario report linked in the PR description (under `--quick`: "scenario deferred to full /flow:validate"). A criterion that can't be met is never skipped — record a blocker in STATE.md and `/pause`.

### 3. Record decisions (DDR sweep)

Walk `## Decisions to record` in the plan. For each unrecorded item run `/flow:record-ddr` (it holds the DDR-worthiness quality gate). No decision is lost.

### 4. Code review (parallel fan-out)

Run the `/flow:validate --review` lane on the uncommitted diff. In **one message** spawn in parallel:

- `security-auditor` + `ethical-hacker` (defender + attacker; reports in `.ai/logs/security-reviews/`). First `maude cache get security "$(git rev-parse HEAD)" --ttl-ms 3600000` — a non-empty result is a fresh review of this HEAD: reuse its report and verdict, skip the spawn (same 1 h window as `/flow:validate` and `/flow:validate --security`).
- `code-simplifier` — must write to a staging copy (`.git/maude-simplifier-staging/`) or return a patch, never edit in place while the auditors read.

After all return: apply the simplifier patch, then re-run static checks + affected tests on the result; revert the patch if it broke anything. **Gate:** `NEEDS FIXES` (CRITICAL) → stop, fix via `/execute`, re-run `/done`. `PASS` / `PASS WITH SUGGESTIONS` → continue. The report `.ai/logs/code-reviews/<branch-name>.md` is committed and linked in the PR.

### 4b. Changelog reminder (soft gate, overridable)

Read `integrations.changelog.provider`:

- `changesets`: if the branch (`git diff --name-only $(git merge-base main HEAD)..HEAD -- .changeset/`) adds no `.changeset/*.md`, ask _"No changeset on this branch. Run /flow:release --changelog before closing? [y/N]"_. y → run it, then return here; N → record the override reason in the PR description under `## Notes`.
- `git-cliff` / `conventional` / `custom`: print that the provider is not implemented; author the note manually.
- `none`: skip silently.

Not every PR is user-visible (chore, infra, internal refactor); the prompt makes that call conscious.

### 4c. Design handoff sweep (soft gate — design plugin)

Skip silently without a design plugin. Soft prompt, not a gate (DDR-066): `/design:handoff` is itself an active decision.

1. Resolve `DESIGN_ROOT=$(jq -r '.paths.designRoot // ".design"' .ai/workflows.config.json)`; missing dir → skip. Find canvases whose `*.meta.json` (excluding `_history/`) has `status: ready-for-handoff`; none → skip silently.
2. Prompt once with the list (path + title): `[Y] all  [N] skip, close anyway  [S] select subset`. N → continue, canvases stay `ready-for-handoff`.
3. Y/S → run `/design:handoff --canvas "<path>"` per canvas **sequentially** (it trims shared CSS). A canvas with open critique blockers fails by design — report it skipped, **never auto-`--force`**.
4. Stage the emitted `<Slug>.registry.json` sidecars so they ride in the feature commit; remember the handed-off paths for 5b.

### 4d. What's New (soft, config-gated)

Read `integrations.whatsNew`; skip silently if absent or `enabled:false`. For a **user-visible** change ask: _"Add a What's New entry for <feature> to <feed>? [Y/n]"_. If `skill` is set, invoke that project skill (it owns shape, append and regen); else append `{ id: <plan-slug>, version: null, date: null, kind: "feature", title, summary }` to the `feed` JSON (version stays pending — the release flow stamps it). Decline → skip. Stage the feed change for the feature commit.

### 5. Commit

**Stay on the current branch** — never silently branch off the default. Branch only when the user asks, or when `conventions.branchingModel` is PR-based (`github-flow` / `gitflow` / `release-branch`) **and** HEAD is the base branch: then ask first. `trunk-based` or already on a feature branch → commit in place.

Conventional commit: `<type>(<scope>): <imperative summary>`, body = what and why, trailers `Refs: .ai/plans/<x>.plan.md`, `DDRs: …`, `Scenario: <report path>`. Types: feat, fix, refactor, docs, test, chore, ci. **Stage specific files**, never `git add -A`. Never `--no-verify` or `--amend` unless the user asked.

### 5b. Mark handed-off canvases (only if 4c handed any off)

`SHA=$(git rev-parse HEAD)` (the feature commit that carries the registry drop); for each handed-off `.meta.json` set `.status = "handed-off" | .handoffCommit = $SHA` via `jq` + temp file; stage those files; one follow-up commit `chore(design): mark <N> canvases handed-off` with `Refs: <feature subject> ($SHA)`. This is the only write a flow command makes into the design root. No `--amend`.

### 6. Push & PR (ask)

_"Publish the branch and open a PR?"_ If yes: `git push -u origin <branch>` then `gh pr create` with body sections **Summary** (2–3 bullets), **Cross-platform validation** (scenario, platforms passed, report link, parity), **Linked** (plan, PRD, DDRs), **Test plan** (run `/scenario <name>`, spot-check screenshots, manual edge cases).

### 6b. Sync tracker (optional)

Read `integrations.tracker`; if `provider` ≠ `none` and the matching MCP is available: take the ticket id from plan front matter / STATE.md and ask _"Mark ticket `<id>` done in `<provider>` and link this PR?"_ Yes → update with `defaults.doneStatus` plus a comment with PR URL + commit hash (pass `defaults` through untouched). No ticket but a tracker is configured → offer to create one only if the PR has no `Closes #`. **`provider: orbit`** → load `flow:orbit-backend`: its resolver finds the key (plan `Ticket: ORB-<n>`, else the branch) and Close recipe § A is the update (`orbit_update_task`, done status + `prUrl`). `none` / no MCP → skip.

### 7. Implementation report

Write `.ai/logs/execution-reports/<feature-name>.md` (**artifact store:** honour `integrations.tracker.artifacts.store` per `flow:orbit-backend` [guide 06](../skills/orbit-backend/_guide-06-artifact-store.md) — `orbit` → `orbit_artifact_push` as kind `execution-report`, `both` → file and push; warn-only, a failed push keeps the file). Sections: **Meta** (plan, ticket, files added/modified, +X −Y) · **Validation** (lint, types, tests X/Y, build, a11y, visual — ✓/✗/skipped) · **What went well** · **Challenges** · **Divergences from plan** (planned / actual / reason) · **Skipped items** · **Recommendations** (plan, execute, rules). Be concrete.

### 8. Retro, CLAUDE.md debrief, archive

**Retro** (plan vs implementation — process bugs, not code bugs). Compare plan and report; classify each divergence **Good** (plan assumption wrong, better approach, security fix) or **Bad** (ignored constraint, shortcut, misread requirement); give each Bad one a root cause (unclear plan / missing context / missing validation) stated specifically ("plan didn't say which auth pattern", not "plan was unclear"). Append `## Retro` to the plan: 3–5 bullets of what worked / didn't / what to change in `/plan` or `/execute` — the next `/plan` reads it. For substantial pivots, parity gaps, blockers or plan rewrites also write `.ai/logs/system-reviews/<feature-name>-review.md` (alignment score /10, divergence analysis, concrete improvement text; same artifact-store rule, pushed as kind `retro`) or a standalone DDR.

**CLAUDE.md debrief** (skip in `--quick`). Did this feature introduce a recurring convention, non-obvious build/test command, naming/directory rule, repeated correction or gotcha? Select the file by host — `CLAUDE.md` (+ `.claude/rules/` for path-scoped) for Claude Code, `AGENTS.md` (nested for directories) for Codex; with both, put shared rules in the shared source and never overwrite the other host's file. Purely architectural facts belong in a DDR, transient progress in STATE.md, structured facts already in `.ai/workflows.config.json` nowhere. Propose the exact edit (≤ 5 lines, concrete and verifiable; keep the file ~200 lines or less), batch via `question-protocol`, apply only if authorized; skip silently when nothing qualifies.

**Record in the graph** (kgai active): `.ai/logs/**` is gitignored, so right after writing each log run `maude kg record-log --file "<path>"` (silent no-op when inactive; with `artifacts.store: orbit` pass the spool path plus `--kind execution-report` / `--kind system-review` and run it **before** the push — guide 06 §2b; contract `flow:kgai-backend`).

**Archive:** move the plan to `.ai/plans/archive/<x>.plan.md` — unless `artifacts.store` is `orbit` (push the final plan, retro included, as kind `plan`; delete the scratch copy only after orbit confirms; `both` → archive and push). STATE.md → status `done`, history row `done | <date> | <one-liner>`, active task/plan `—`.

> **kgai close (when `maude kg resolve --json` is `active`, see `flow:kgai-backend`).** Decisions already went in via `/flow:record-ddr`. Mark the plan closed and push once (`kg sync` is a close-time op, never per-edit):
> `echo '{"decision":{"title":"Closed: <feature>","rationale":"<retro one-liner>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"plan","name":"<plan-slug>","props":{"status":"done"}}]}}' | maude kg ingest --root .` then `maude kg sync --warn-only --root .`.

> **orbit close (`provider: orbit`).** Last, after archive: `flow:orbit-backend` Close recipe § B + C — `orbit_artifact_push` the plan, RCA, execution report, code review and retro that exist, then `orbit_state_report` `done`. Warn-only (`⚠ orbit: …`); never blocks or rolls back. Unchanged in `--quick`.

**Coverage baseline (opt-in):** if `skills.coverageTrend.enabled` and the branch equals `baselineBranch` (default `main`), write `.ai/state/coverage-baseline.json` `{ "coverage": <%>, "recordedAt": "<date>", "branch": "<branch>" }`; on any other branch skip (a feature-branch value doesn't represent main).

### 9. Report

```
✓ Done: <feature name>                      (quick: "⚡ Done (quick)")
  Validate: ✓ all gates passed              (quick: "⚡ quick — static gates + affected tests only")
  Scenario: 5/5 platforms PASS — <report>   (quick: Skipped: build, scenario, a11y, design-system → run full /flow:validate before merging to main)
  Code review: ✓ <verdict> — .ai/logs/code-reviews/<branch>.md
  Simplifier: <files touched / skipped>
  Commit: <hash> <subject>
  PR: <URL or "—">
  Tracker: <ticket id @ provider, status updated | "—">
  DDRs recorded: <N>
  Plan archived: .ai/plans/archive/<x>.plan.md
  Time in execution: <approx>
  Spend: <lead peak · agents share · flagged agents>   (only when a run marker or session id is known — `maude flow usage`)
```

Suggest: _"Run /flow:run --status for a project overview."_
