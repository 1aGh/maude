---
name: done
category: daily
description: "Validate and close a feature: decision capture, delivery, retrospective and archive within authorized scope."
argument-hint: "[--quick] [path to plan]"
---

# /done — close out a feature

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

This is the **final gate**. Run it after `/execute` when all tasks pass. It consolidates verification, commit, and push into a single action.

Input: `$ARGUMENTS` — optionally `--quick` (anywhere in the string) plus a path to the plan file. If no path is given, use the one from `.ai/state/STATE.md`.

**`--quick` trims Step 1 only** (full `/validate` → affected-scope checks — see below). Steps 2–7 (acceptance check, DDR sweep, code review, changelog/handoff/what's-new prompts, commit, push/PR, tracker sync, retro/archive) are **unchanged** — due diligence and tracking are exactly the parts `--quick` does not cut. Use it for routine/interim closes where you'll run a full `/flow:validate` before the branch merges to main; don't reach for it on anything from the `/flow:quick` guardrail list (auth, migrations, cross-package, CI config, security-sensitive).

## Process

### 1. Run `/validate` (hard gate) — or the quick equivalent

**Default (no `--quick`):** `/validate` performs static analysis, tests, build, **cross-platform scenario** (`scenario-runner` subagent across 5 platforms), a11y audit, design consistency, and decision drift check.

If anything in `/validate` fails → stop. Return to `/execute` to fix. After the fix, run `/done` again.

> **Quality gates** (`config.quality.*` — format / lint / typecheck / tests / build) run **inside** `/flow:validate` (Phase A Layer 7, see the `flow:quality-gates` skill). `/flow:done` adds no separate gate invocation — single source of truth, no double CI time.

**Key gate:** the scenario report must have `blockers == 0` AND `parity_ok == true` (or a clear DDR explaining intentional divergence).

**With `--quick`:** skip the `/validate` invocation entirely and run this reduced pipeline instead — the goal is affected-scope confidence, not exhaustive coverage:

1. **Static gates**, blocking, same commands as `/validate` step 1 (`config.quality.{format,lint,typecheck}` — see `flow:quality-gates`), but no build.
2. **Affected tests only** — same scope as `/flow:utils-verify` (tests touching changed files), not the full `quality.tests` suite.
3. **Skipped:** `quality.build`, `scenario-runner` (cross-platform), `a11y-auditor`, `design-system-guard`. These are the expensive parts (DDR-061: "the cross-platform scenario alone is 2–3 min cold") and the reason `--quick` gets you from ~20 min to ~5.
4. `security-auditor` + `ethical-hacker` are **not** skipped — they still run in Step 4 (Code review) below, same as always. Quick mode doesn't touch security due diligence.

Record in the Step 8 report which gates were skipped so it's never silently unclear this wasn't a full validate (see updated report template in Step 8).

**Stop condition unchanged:** any failing static gate or a failing affected test → stop, fix, retry — same as the full path.

### 2. Acceptance criteria check

Walk through `## Acceptance Criteria` in the plan, check off or flag each criterion. Key items:

- [ ] All tasks completed
- [ ] `/validate` passes (incl. scenario, a11y, design system) — under `--quick`, the static gates + affected tests pass instead; note the deferred full validate in STATE.md
- [ ] No DDR-worthy decision left unrecorded
- [ ] Scenario report linked in PR description — under `--quick`, omit and note "scenario deferred to full /flow:validate" instead

If a criterion can't be met, **don't skip** — record a blocker in STATE.md and /pause.

### 3. Record decisions (DDR sweep)

Walk through `## Decisions to record` in the plan. For each unrecorded item run `/flow:record-ddr` (or do it inline). **No decision is lost.** The `ddr-keeper` skill provides a quality gate.

### 4. Code review (parallel fan-out)

Run `/flow:review-code` on uncommitted changes. The audit and the simplifier read the **same diff** and produce **independent** outputs, so they run concurrently; the recheck is sequential after both finish.

**In a single assistant message, spawn these subagents in parallel using parallel Agent tool calls:**

- `security-auditor` + `ethical-hacker` — audit pass (defender + attacker; reports land in `.ai/logs/security-reviews/`). **First `maude cache get security "$(git rev-parse HEAD)" --ttl-ms 3600000`** (Phase C / DDR-061, the shared `security/<head-sha>` layer, TTL 1 h) — a non-empty result means a fresh review exists for this HEAD: reuse its report + verdict and skip the spawn. This is the same window `/flow:validate` and `/flow:validate-security` use (one source of truth, recipe in `validate-security.md` pre-flight step 3). On miss, these two are a parallel pair — spawn both here, in the same message, not in a nested sub-block.
- `code-simplifier` — auto-fixes stylistic issues (clarity, nesting, naming) on a working copy.

> **Race guard:** `code-simplifier` mutates files while the auditors read them. To keep the audit reading the original, the simplifier must write to a staging copy (`.git/maude-simplifier-staging/`) or return a patch rather than editing in place — the auditors always read the committed/working originals. Apply the simplifier's patch only **after** all three return.

After all three return: apply the simplifier patch, then run a recheck pass (static checks + affected tests) on the simplified diff to confirm no regressions. If the simplifier broke something, revert its patch.

**Hard gate:**

- Verdict `NEEDS FIXES` (CRITICAL findings) → stop. Return to `/execute` to fix. Re-run `/done` after the fix.
- Verdict `PASS` or `PASS WITH SUGGESTIONS` → continue to commit.

The review report at `.ai/logs/code-reviews/<branch-name>.md` is committed with the feature changes (linked in the PR description).

### 4b. Changelog reminder (soft gate, overridable)

> Same provider-dispatch shape as `/flow:validate` Step 7b. Non-blocking, but at `/done` it's an explicit prompt rather than a passive warning — closing out the feature is the right moment to remember the release note.

Read `integrations.changelog.provider` from `.ai/workflows.config.json`.

```
IF provider === "changesets":
  diff = git diff --name-only $(git merge-base main HEAD)..HEAD -- .changeset/
  IF no new .changeset/*.md on the branch:
    PROMPT: "No changeset detected on this branch. Run /flow:release-changelog before closing? [y/N]"
    IF y → run /flow:release-changelog, then loop back here once authored.
    IF N → record override reason ("user-visible? <reason>") in the PR description under `## Notes`.
ELIF provider IN (git-cliff, conventional, custom):
  PRINT: "[done] changelog: provider `<name>` not yet implemented — author your release note manually."
ELSE (none):
  skip silently
```

The override path is intentional: not every PR ships user-visible change (chore, infra, internal refactor). The reminder exists so the team makes that call **consciously**, not by forgetting.

### 4c. Design handoff sweep (soft gate — design plugin)

> Skip silently when the project has no design plugin. This is a **soft prompt, not an enforced gate** — see [DDR-066](../../../.ai/archive/decisions/DDR-066-soft-handoff-prompt-in-flow-done.md): auto-handoff would burn user context and `/design:handoff` is itself an active decision (which target, which DS), so flow surfaces the choice and lets the user decide.

Before committing, surface any canvas the user marked **`ready-for-handoff`** so an approved design doesn't ship a feature without its production-ready registry drop.

1. **Resolve + scan (read-only).** Resolve `paths.designRoot` from `.ai/workflows.config.json` (default `.design`). If the directory doesn't exist → skip this step silently. Otherwise scan sidecars for `status: ready-for-handoff`:

   ```bash
   DESIGN_ROOT=$(jq -r '.paths.designRoot // ".design"' .ai/workflows.config.json 2>/dev/null || echo ".design")
   [ -d "$DESIGN_ROOT" ] && while IFS= read -r f; do
     [ "$(jq -r '.status // "draft"' "$f")" = "ready-for-handoff" ] && echo "${f%.meta.json}.tsx"
   done < <(find "$DESIGN_ROOT" -name '*.meta.json' -not -path '*/_history/*' 2>/dev/null)
   ```

2. **If none → skip silently.** No prompt, no noise.

3. **If any → prompt once** with the sorted list (path + title):

   ```
   N canvases are marked ready-for-handoff:
     - .design/ui/DarkModeToggle.tsx  "Dark Mode Toggle"
     - .design/ui/Settings.tsx        "Settings"
   Run /design:handoff before closing?
     [Y] all   [N] skip, close anyway   [S] select a subset
   ```

   - **[N]** → continue to Commit unchanged. The canvases stay `ready-for-handoff`.
   - **[Y] / [S]** → dispatch handoff per accepted canvas **sequentially** (not parallel — handoff trims shared CSS per canvas; interleaved writes can corrupt the slice). For each: run `/design:handoff --canvas "<path>"`. If a canvas's latest critique has open blockers, `/design:handoff` fails by design — **report that canvas as skipped, do NOT auto-`--force`** (forcing past a blocker is the user's call, not flow's). Each successful handoff emits a `<Slug>.registry.json` sidecar in `<designRoot>/`.

4. **Stage the emitted sidecars.** The `.registry.json` files land in the working tree — stage them so they ride in the **same feature commit** (step 5). Record the list of successfully-handed-off canvas paths for step 5b.

> The meta status flip (`status → handed-off`, `handoffCommit → <sha>`) happens **after** the feature commit exists — see step 5b. Doing it here would have no SHA to record yet.

### 4d. Surface the shipped feature (What's New — soft, config-gated)

> Reads `integrations.whatsNew` from `.ai/workflows.config.json`. Skip silently when absent or `enabled:false`. Project-agnostic + opt-in — the flow plugin never hardcodes a feed path.

The docs-site bump isn't the only user-facing surface — when a project drives an in-product "What's New" feed, the UI should announce the feature too. When `integrations.whatsNew.enabled` is true, offer (for a **user-visible** change only — same judgment as 4b):

```
PROMPT: "Add a What's New entry for <feature> to <integrations.whatsNew.feed>? [Y/n]"
```

- **If `integrations.whatsNew.skill` is set** → invoke that project skill; it owns the entry shape, append, and any site-feed regen. (Maude delegates to the `whats-new-entry` skill.)
- **Else** → append a minimal entry to the configured `feed` JSON yourself: `{ id: <plan-slug>, version: null, date: null, kind: "feature", title, summary }`. `version` stays **null/pending** — the project's release flow stamps it.
- **If the user declines** → skip. Not every feature is user-visible.

Stage the feed change so it rides in the feature commit (step 5).

### 5. Commit

> **Branch handling — don't auto-branch; stay on the current branch.** Commit on whatever branch is checked out — do **not** silently branch off the default branch first (this overrides the generic "if on the default branch, branch first" reflex). Create a new branch only when the user explicitly asks, or — if `conventions.branchingModel` is a PR-based model (`github-flow` / `gitflow` / `release-branch`) **and** HEAD is the base/default branch — surface it and **ask first**, then branch. For `trunk-based`, or when already on a feature branch, commit in place. (The push/PR decision in step 6 still follows `branchingModel`.)

Conventional commit. Format:

```
<type>(<scope>): <imperative summary>

<body: what and why, not how>

Refs: .ai/plans/<x>.plan.md
DDRs: .ai/decisions/DDR-<NNN>.md (if any were created)
Scenario: .ai/device/scenario-runs/<name>/<ts>/report.md
```

- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`.
- **Stage specific files**, not `git add -A` (secrets / out-of-scope changes).
- **NEVER** use `--no-verify` or `--amend` unless the user asked for it.

### 5b. Mark handed-off canvases (only if step 4c handed any off)

Skip unless step 4c successfully handed off at least one canvas. For each such canvas, flip its sidecar status and stamp the feature commit's SHA, then commit the bookkeeping as **one** follow-up commit (this is the only write a flow command makes into the design root):

```bash
SHA=$(git rev-parse HEAD)   # the feature commit from step 5 — the commit that carries the registry drop
for META in "$@"; do        # $@ = the .meta.json sidecars for canvases handed off in 4c
  tmp=$(mktemp)
  jq --arg sha "$SHA" '.status = "handed-off" | .handoffCommit = $sha' "$META" > "$tmp" && mv "$tmp" "$META"
done
git add <those .meta.json files>
git commit -m "chore(design): mark <N> canvases handed-off

Refs: <feature commit subject> ($SHA)"
```

`handoffCommit` points at the feature commit (which contains the registry sidecars), not at this bookkeeping commit — so a reader can find the actual handoff payload from the meta. No `--amend`; the bookkeeping is a clean separate commit.

### 6. Push & PR (optional — ask)

_"Publish the branch and open a PR?"_ — if yes:

- `git push -u origin <branch>`
- `gh pr create` with body:

```markdown
## Summary
<2–3 bullets of what changed>

## Cross-platform validation
- Scenario: `<name>`
- Result: <X>/<Y> platforms PASS
- Report: [.ai/device/scenario-runs/<name>/<ts>/report.md](<repo URL>)
- Parity: ✓ identical counter-delta

## Linked
- Plan: .ai/plans/<x>.plan.md
- PRD: <§ parent or path>
- DDRs: <list>

## Test plan
- [ ] Run `/scenario <name>` locally against the checked-out branch
- [ ] Spot-check screenshots in scenario report
- [ ] <any manual edge cases>
```

### 6b. Sync tracker (optional)

Read `integrations.tracker` from `.ai/workflows.config.json`. If `provider` is not `none` and an MCP tool with the matching `mcp` prefix is available:

- Look at the plan front matter or `STATE.md` for a ticket ID (e.g. `tracker: ABC123` or `clickup: 86c7vx11y`).
- Ask the user: _"Mark ticket `<id>` as done in `<provider>` and link this PR?"_
  - If **yes** → call `<mcp>_*_update_task` (or provider equivalent) with the done status from `defaults.doneStatus` and append a comment with the PR URL + commit hash. Generic command — pass `integrations.tracker.defaults` through untouched; the MCP server interprets it.
  - If **no** → skip silently.
- If no ticket ID is recorded but a tracker is configured → ask: _"Create a tracker ticket for this work?"_ (rare on `/done` — usually tickets exist before; offer only if PR has no `Closes #` reference).

**`provider === "orbit"`** → load **`flow:orbit-backend`**: its resolver finds the key (plan Metadata `Ticket: ORB-<n>`, else the branch name) and its Close recipe § A is the update (`orbit_update_task` with the done status + `prUrl`). Same question as above. The artifact push and the final state run at the end of Step 7, so the pushed plan carries its retro.

If `provider === "none"` or no MCP available → skip this step entirely. The command stays useful without any tracker.

### 6c. CLAUDE.md debrief (optional — skipped in `--quick`)

> Not tracking or due diligence — a conventions-capture nicety. Skip in `--quick` to save the extra subagent round-trip; run it later via a plain `/flow:done` or ad hoc.

Invoke the `claude-md-keeper` skill with the feature's plan + commit diff as context:

> One-line check: did this feature introduce a new convention, build step, or "always do X" rule that belongs in CLAUDE.md? (Each line in CLAUDE.md is in every future session's context, so be sparing — only rules that will save the next agent from a re-correction.)

If the user lists items, propose CLAUDE.md additions (or moves to `.claude/rules/<topic>.md` for path-scoped rules). Keep file ≤200 lines. Skip silently if no relevant change.

### 7. Retro & archive

- Append a `## Retro` section to the end of the plan. 3–5 bullets: what worked / what didn't / what to change in `/plan` or `/execute` next time. This is the learning loop — the next `/plan` reads it.
- If there were unexpected pivots, parity gaps, blockers, or plan rewrites → consider a standalone DDR ("what we learned about this domain") or a full `/flow:record-retro`.
- Move the plan to `.ai/plans/archive/<x>.plan.md`.
- STATE.md → phase + status `done`, history row `done | <date> | <one-liner>`. Active task → `—`. Active plan → `—`.

> **kgai close (when active).** If `maude kg resolve --json` reports `active` (load `flow:kgai-backend`): the DDR sweep (Step 3) already routed decisions into the graph via the backend-aware `/flow:record-ddr`; here, mark the plan node closed and **push once** — `kg sync` is a close-time operation (never per-edit; the projection rebuild grows with the log):
>
> ```bash
> echo '{"decision":{"title":"Closed: <feature>","rationale":"<retro one-liner>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"plan","name":"<plan-slug>","props":{"status":"done"}}]}}' | maude kg ingest --root .   # upsert props MERGE — status flips, path stays
> maude kg sync --warn-only --root .   # no-op when local-only; warns (never blocks the close) on remote-sync failure
> ```
>
> When `active:false` the STATE.md/history behavior above is unchanged.

> **orbit close (`integrations.tracker.provider: orbit`).** Last, after the plan is archived: run `flow:orbit-backend` Close recipe § B + C — push the plan, RCA, execution report, code review and retro that exist via `orbit_artifact_push`, then `orbit_state_report` `done`. **Warn-only:** a failed call prints `⚠ orbit: …` and the close continues — orbit never blocks or rolls back a close. Unchanged in `--quick`.

#### 7a. Refresh coverage baseline (opt-in)

> Reads `skills.coverageTrend` from `.ai/workflows.config.json`. Skip silently if `enabled: false` or missing.

When enabled **and** the active branch matches `skills.coverageTrend.baselineBranch` (default `main`) — i.e. this `/done` is closing out a feature on the baseline branch — refresh `.ai/state/coverage-baseline.json`:

```json
{ "coverage": <current %>, "recordedAt": "<YYYY-MM-DD>", "branch": "<active branch>" }
```

If the active branch is *not* the baseline branch (typical PR flow where `main` is updated by merge, not by direct `/done`) → skip silently. Recording from a feature branch would lock in a value that doesn't represent main; the merge into `main` is when a fresh `/done` (or a CI-side hook) refreshes the baseline.

### 8. Report

Default (no `--quick`):

```
✓ Done: <feature name>
  Validate: ✓ all gates passed
  Scenario: 5/5 platforms PASS — <report path>
  Code review: ✓ <verdict> — .ai/logs/code-reviews/<branch>.md
  Simplifier: <files touched / skipped>
  Commit: <hash> <subject>
  PR: <URL or "—">
  Tracker: <ticket id @ provider, status updated | "—">
  DDRs recorded: <N>
  Plan archived: .ai/plans/archive/<x>.plan.md
  Time in execution: <approx>
```

With `--quick`, replace the `Validate` line and add a skip note so the trade-off is never silent:

```
⚡ Done (quick): <feature name>
  Validate: ⚡ quick — static gates + affected tests only
  Skipped:  build, cross-platform scenario, a11y audit, design-system check
            → run a full /flow:validate before merging to main
  Code review: ✓ <verdict> — .ai/logs/code-reviews/<branch>.md
  Simplifier: <files touched / skipped>
  Commit: <hash> <subject>
  PR: <URL or "—">
  Tracker: <ticket id @ provider, status updated | "—">
  DDRs recorded: <N>
  Plan archived: .ai/plans/archive/<x>.plan.md
  Time in execution: <approx>
```

Suggest: _"Run /flow:status for a project overview, or /flow:record-retro for a process retrospective?"_
