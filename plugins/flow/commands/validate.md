---
name: validate
category: daily
type: command
description: "Run quality gates and validation lanes: full pipeline, --fast, --security, --a11y, --visual, --review, --scenario."
keywords: [validate, fast, security, a11y, visual, review, scenario, cross-platform, design-system]
argument-hint: "[--fast | --security | --a11y | --visual | --review | --scenario [name|new <name>]] [--force]"
---

# /flow:validate — gates and validation lanes

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

One command, several lanes. Pick the lane from `$ARGUMENTS`; no lane flag = the full pipeline.

| Flag | Lane | When |
| ---- | ---- | ---- |
| (none) | Full pipeline (below) | Before `/flow:done`, before push, reviewing older code |
| `--fast` | Scoped inner-loop check | After each task in `/flow:execute` |
| `--security` | Defender + attacker review | Auth, input, deps, MCP, prompts, trust boundaries |
| `--a11y` | WCAG 2.1 AA audit | UI changes |
| `--visual` | Screenshot regression | UI changes |
| `--review` | Review of uncommitted changes | Before commit |
| `--scenario [name\|new <name>]` | Cross-platform scenario run / authoring | UI features |

Gates come from `.ai/workflows.config.json` per the `flow:quality-gates` skill. A missing gate skips with a warning, never fabricated.

## Full pipeline (no flag)

Order: config health → format/lint/typecheck → tests → build → custom gates → parallel lanes → drift checks → report. **Stop on first hard fail**, accumulate soft warnings.

**Default lanes:** scenario-runner, a11y-auditor, design-system-guard and the security pair (`security-auditor` + `ethical-hacker`) all run in step 4 (design/a11y/scenario for UI work). Security is skipped when `skills.securityRules.enabled == false`, its AI/MCP lens when `security.includeAi == false`, and reused from cache when fresh. `--visual` and `--review` run only on request.

### 0. Skip-if-clean (DDR-061)
Don't re-run when the tree is byte-identical to the last **green** validate within 24 h. `--force` in `$ARGUMENTS` bypasses it.

```bash
if ! grep -q -- '--force' <<< "$ARGUMENTS"; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
  TREE_SHA=$(printf '%s\n%s' "$(git rev-parse HEAD 2>/dev/null)" "$(git status --porcelain 2>/dev/null)" | git hash-object --stdin | cut -c1-12)
  LAST=$(maude cache get validate "$BRANCH" --ttl-ms 86400000 2>/dev/null)
  if [ -n "$LAST" ] && [ "$(jq -r '.tree_sha' <<< "$LAST")" = "$TREE_SHA" ] && [ "$(jq -r '.result' <<< "$LAST")" = "green" ]; then
    echo "✓ Last validate GREEN at $(jq -r '.validatedAt' <<< "$LAST") on this tree ($TREE_SHA) — skipping. Report: $(jq -r '.reportPath // "(none)"' <<< "$LAST"). Use --force to re-run."
    exit 0
  fi
fi
```

The fingerprint folds in `git status --porcelain` so dirty edits count. The cache is keyed on branch, auto-gitignored, and written only on green (step 8b).

### 0.5 Config health (blocker)
```bash
maude doctor --json | jq -e '.summary.schemaErrors == 0' >/dev/null \
  || { echo "::error::config schema errors in .ai/workflows.config.json — run \`maude doctor --fix\`"; exit 1; }
```
Stack drift and missing quality additions are warnings only (report in step 8). Never call `maude doctor --fix` from validate; print the command.

### 1. Static analysis — `quality.{format,lint,typecheck}`
Run `typecheck` and `lint` in parallel (two Bash calls in one message); run `format` after they return (so lint-suggested fixes aren't flagged). Each gate:

```bash
CMD=$(jq -r '.quality.<gate> // empty' .ai/workflows.config.json)
if [[ -n "$CMD" ]]; then echo "→ <gate>: $CMD"; eval "$CMD" || { echo "::error::<gate> gate failed (\`$CMD\`)"; exit 1; }
else echo "⚠ quality.<gate> not declared — run \`maude doctor --fix\` (skipping)"; fi
```

### 2. Tests — `quality.tests` (same pattern)
Full suite; report coverage but don't block on a threshold.

**2a. Coverage trend (opt-in, non-blocking).** When `skills.coverageTrend.enabled` and the runner prints a coverage %: compare with `.ai/state/coverage-baseline.json` (`{coverage, recordedAt, branch}`). If the drop exceeds `skills.coverageTrend.warnThresholdPp` (default 1.0 pp) → warn in the report and point at the `flow:test-coverage` subagent. Never a blocker. No baseline → record silently and note `coverage baseline established`. Baseline refresh belongs to `/flow:done`.

### 3. Build — `quality.build` (same pattern)
Also report bundle-size delta when tooling exists (`size-limit`, `bundlewatch`).

### 3.5 Custom gates
Every `quality.*` key beyond `format|lint|typecheck|tests|build` runs here in declaration order (blocker): `for gate in $(jq -r '.quality | keys[]' …)`, skip the five conventional names, `eval` the rest. This mirrors a project's CI locally. The `qualityScoped` block is `--fast`'s and is ignored here.

### 4. Parallel fan-out: cross-platform + a11y + design + security
Resolve config **once** and pass values inline in each spawn prompt (subagents don't inherit this conversation):

```bash
SEV_FLOOR=$(jq -r '.security.severityFloor // "medium"' .ai/workflows.config.json)
INCLUDE_AI=$(jq -r '.security.includeAi // true' .ai/workflows.config.json)
SEC_SCOPE=$(jq -rc '.security.scope // ["classic","ai"]' .ai/workflows.config.json)
SEC_ENABLED=$(jq -r '.skills.securityRules.enabled // true' .ai/workflows.config.json)
```

In a single message, spawn in parallel:
- `scenario-runner` — per the `scenario` skill; picks scope from the diff, reads `.ai/scenarios/` + the active plan; returns `report_path, platforms_run, results, blockers, parity_ok, follow_ups`.
- `a11y-auditor` — live axe-core scan over affected routes; pass `scenario_screenshot_dir` so it folds in scenario frames without blocking on the runner.
- `design-system-guard` — token/component conformance, scenario screenshots as primary evidence.
- `security-auditor` + `ethical-hacker` — pass `severityFloor`, `includeAi`, `scope` inline. Reuse a fresh review first (`maude cache get security "$(git rev-parse HEAD)" --ttl-ms 3600000`; same cache as `--security`): on a hit surface the cached verdict + path and skip the spawn.

Wait for all to return. **kgai:** when the security pair actually ran (not on a cache hit), record the merged report: `maude kg record-log --file ".ai/logs/security-reviews/<branch>-<ts>.md"` (silent no-op when the graph is inactive; contract `flow:kgai-backend`).

### 5. Exit gates
- **Scenario:** UI feature with no scenario → HARD FAIL (`/flow:validate --scenario new <name>`); `blockers > 0` → fail; `parity_ok == false` → needs a DDR explaining the divergence or a parity fix; a platform skipped only for an unbooted sim → warning (soft fail if the user should have run it).
- **A11y / design:** WCAG 2.1 AA blockers and design-system violations are blockers (file:line in the report).
- **Security:** findings at severity ≥ `severityFloor` → fail. `exploit_chains > 0` is informational alone, but a chain combining a medium defender and a medium attacker finding promotes to high = blocker.

### 7. Doc / decision drift
Active plan without `## Retro` after `/flow:done` → flag. DDR-worthy change (new library, top-level dir, schema) without a DDR → suggest `/flow:record-ddr`. Scenario report without identical counter-delta across platforms and no DDR → blocker.

**7b. Changelog hygiene (non-blocking).** Read `integrations.changelog.provider`: `changesets` → warn if no new `.changeset/*.md` since the merge-base with `main` (use `git merge-base main HEAD`, not `HEAD~1`) and mark "passed with warnings"; `git-cliff|conventional|custom` → note "not yet implemented"; `none` → silent.

### 8. Report
```
## /flow:validate — <YYYY-MM-DD HH:MM>
✓ types | ✓ lint | ✓ format
✓ tests: 142/142 (coverage 78%; trend line only when coverageTrend enabled)
✓ build: 3 apps OK (bundle delta +2.1 KB web)
✓ scenario: <name> 5/5 PASS — report <path> — parity ✓
✓ a11y: 0 blockers, 2 warnings | ✓ design system: 0 violations | ✓ security: <verdict> | ✓ DDR drift: 0
```
Append a non-blocking config line from `maude doctor --json` (`driftCount`, `qualityAdditions`; suggest `maude doctor --fix` when > 0). All green → continue to `/flow:done`.

**8b. Record green (DDR-061).** Only on GREEN (all hard gates pass, scenario `blockers == 0`, no security finding ≥ floor), write the step-0 `TREE_SHA` for the next run: `printf '{"tree_sha":"%s","result":"green","validatedAt":"%s","reportPath":"%s"}' "$TREE_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SCENARIO_REPORT_PATH:-}" | maude cache put validate "$BRANCH"`. A red result writes nothing.

## `--fast` — inner-loop check

Cheap by construction (15–60 s regardless of repo size): only scoped commands run; anything unscoped is **deferred**, never run repo-wide. Used by `/flow:execute` after each task (max 3 fix iterations). No repo-wide gates, parity, full suite or whole-project builds — those are the default pipeline.

1. **Scope:** `git diff --name-only` and `git diff --name-only main...HEAD`. Classify: source → static + browser smoke (if UI); `.test.*` → affected tests; css → static + visual smoke; RN dirs → agent-device smoke; backend/config → static only.
2. **Scoped gates + affected tests** (see `flow:quality-gates` § "Inner loop vs outer gate"). Changed filenames are UNTRUSTED — collect NUL-safe and `printf '%q'` each before any `eval`:
   ```bash
   CHANGED=""
   while IFS= read -r -d '' f; do CHANGED+="$(printf '%q' "$f") "; done \
     < <({ git diff -z --name-only --diff-filter=d; git diff -z --cached --name-only --diff-filter=d; } | sort -zu)
   for gate in format lint typecheck; do
     SCOPED=$(jq -r ".qualityScoped.$gate // empty" .ai/workflows.config.json)
     if [[ -n "$SCOPED" ]]; then eval "$SCOPED" || { echo "::error::$gate scoped gate failed"; exit 1; }
     elif [[ "$gate" != "typecheck" ]]; then
       CMD=$(jq -r ".quality.$gate // empty" .ai/workflows.config.json)   # only if the tool accepts file args
       if [[ -n "$CMD" && -n "$CHANGED" ]]; then eval "$CMD -- $CHANGED" || { echo "::error::$gate failed on changed files"; exit 1; }
       else echo "→ $gate: no scoped gate — deferred to /flow:validate"; fi
     else echo "→ typecheck: no qualityScoped.typecheck — deferred to /flow:validate"; fi   # tsc ignores file args
   done
   ```
   - **Affected tests only**, never the full `quality.tests`. Apply the **filter-sanity guard** (`flow:quality-gates` §7): if the reported test-file count is near the full suite, the filter was swallowed — switch to the runner's exec form (`pnpm --filter X exec vitest run <pattern>`) for the rest of the session.
   - In monorepos scope by changed packages (`[base]`), not changed-plus-dependents (`...[base]`).
3. **UI smoke** — fire only the legs the diff triggers; run web and native in parallel when both apply.
   - Web: `agent-browser open <local route>` → `snapshot -c` → `screenshot .ai/device/verify/<ts>-<task>.png`. Checks the page loads and key plan elements exist (not a scenario).
   - Native: boot UDID via `xcrun simctl list devices booted -j`, `agent-device --platform ios open <bundle> --udid …`, `snapshot -i`, `screenshot`. Checks app starts, affected screen reachable, no red-screen.
4. **Optional subagents** for UI tasks, in the same parallel batch: `a11y-auditor`, `design-system-guard`.
5. **Report** deferred gates explicitly (`✓ lint (scoped) …`, `→ typecheck: deferred …`, `✓ tests: 5/5 (filter verified)`, smoke, warnings).
6. **Config drift nudge** (soft): `maude doctor --json | jq -e '(.summary.driftCount + .summary.qualityAdditions) == 0' || echo "⚠ run maude doctor --fix when convenient"`. Gate failures block; this does not.

## `--security` — security review

Defender (`security-auditor`, OWASP-class over changed files) and attacker (`ethical-hacker`, threat model, chained exploits, mandatory AI/MCP surface: prompt injection, tool poisoning, confused-deputy, the trifecta). Read-only; the attacker thinks on paper. Arguments: `[--since <ref>] [--include-ai | --no-ai]`.

1. **Pre-flight.** Read `skills.securityRules.enabled` (false → exit with notice), `security.severityFloor` (default `medium`), `security.scope` (default `["classic","ai","supply-chain"]`), `security.includeAi` (false or `--no-ai` → AI/MCP section `N/A — disabled by config`). Diff scope: `BASE=$(git merge-base main HEAD || git merge-base origin/main HEAD || echo HEAD~1)`; `git diff --name-only "$BASE"...HEAD` plus uncommitted (honor `--since`). Empty diff → "No changes to review." and exit.
2. **Reuse a fresh review** (the single `security/<head-sha>` cache shared with `/flow:done` and the full pipeline): `REUSE=$(maude cache get security "$(git rev-parse HEAD)" --ttl-ms 3600000)`. Non-empty → print `Reusing security review <reportPath>`, surface the verdict, skip spawning.
3. **Adversarial debate (DDR-130, END bookend, opt-out).** Read `orchestration.*` (absent = `auto`). If `mode` is `auto`, `bookends.adversarial.enabled` is not `false` and native agent-teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) is detected: load `flow:debate-protocol` and run the 2-seat **relay** debate (`ethical-hacker` = ATTACKER, `security-auditor` = DEFENDER): attacker proposes the chain → defender rebuts with the mitigating control → attacker rebuts whether the chain survives. Stakes-gate, blind opening and short-circuit apply (clean diff → today's verdict at ≈ one reduce-pass). Reconciled findings feed step 5. Never prompt the user, never hand-roll relay in markdown. Otherwise (`reduce` tier, `mode:off`, no capability, bookend disabled) run step 4 as-is — the default for users without the flag. Severity/scope/includeAi apply regardless of tier.
4. **Run protocol.** Unless the debate handled it, spawn both in parallel (two Task calls, one message): `flow:security-auditor` ("audit the diff against `security-rules` §A; base, floor; write `.ai/logs/security-reviews/<branch>-<ts>-defender.md`; return JSON") and `flow:ethical-hacker` ("adversarial threat model; base, floor, includeAi, defender report path; write `…-attacker.md`; return JSON; mandatory AI/MCP section"). Both must finish even if one finds blockers — chains can promote a defender medium.
5. **Aggregate** to `.ai/logs/security-reviews/<branch>-<YYYYMMDD-HHMM>.md`: TL;DR table (Defender / Attacker / Combined: blockers, warnings, headline), floor, AI/MCP lens on/off, chains count, then Defender findings, Attacker findings, Exploit chains (steps + promoted severity), AI/MCP surface, Combined gate decision (blockers ≥ floor, verdict PASS / PASS WITH WARNINGS / FAIL) and Next step. Then record the cache: `printf '{"reportPath":"%s","verdict":"%s","blockers":%s}' "$REPORT_PATH" "$VERDICT" "${BLOCKERS:-0}" | maude cache put security "$HEAD_SHA"`.
6. **kgai.** `maude kg record-log --file ".ai/logs/security-reviews/<branch>-<YYYYMMDD-HHMM>.md"` — merged report only, not the per-agent drafts; silent no-op when inactive (`flow:kgai-backend`).
7. **Gate.** `combined.blockers > 0 && severity >= severityFloor` → FAIL (print top finding, exit non-zero); chains informational unless they promote a defender-medium to high; warnings alone never block. On FAIL ask: "Found <N> blockers. Should I open the report and propose fixes?"

## `--a11y` — accessibility audit

Targeted WCAG 2.1 AA audit of changed or specified components; the `a11y-auditor` agent and `flow:ui-rules` skill (Accessibility) hold the checklist (semantics, ARIA, keyboard, contrast, images, forms) — apply them. Run the project's lint for `jsx-a11y/*` violations (detect the package manager from the lockfile), review each changed component, and use agent-browser axe-core where a live app is available. Save to `.ai/logs/a11y/<date>-audit.md`: components reviewed, findings by CRITICAL (blocks ship) / IMPORTANT / SUGGESTION, counts. Then `maude kg record-log --file ".ai/logs/a11y/<date>-audit.md"` (silent no-op when the graph is inactive). If issues: ask "Found X accessibility issues. Should I fix them?"

## `--visual` — screenshot regression

1. List the changed pages/components/states. 2. Start the dev server and wait until ready. 3. Capture each target at mobile 375×812, tablet 768×1024, desktop 1440×900 into `/tmp/ai-workflow-visual/` (not the project root). 4. Review: layout, readable text, design tokens, spacing, hover/focus/active states, overflow/artifacts, icons, animation. 5. If the project supports dark mode, re-capture key shots and check contrast.

Save to `.ai/logs/visual/<date>-visual.md` (targets × viewport pass/fail table, issues with screenshot refs, verdict PASS / NEEDS FIXES), then `maude kg record-log --file …` (silent no-op when inactive). If issues: ask "Found X visual issues. Should I fix them?"

## `--review` — review of uncommitted changes

Self-review before commit. Principles: simplicity, readability, the best code is code you don't write.

1. **Gather:** `git diff --stat`, `git diff --staged --stat`, `git diff --name-only HEAD`.
2. **Review each file** for correctness (logic, edges, off-by-one, null handling, races), quality (naming, single responsibility, duplication, leftover commented-out code), tests (coverage, edge cases, independence), conventions (existing patterns, formatting, import order, file placement) and project instruction files (e.g. `instructions/*.instructions.md`).
3. **Security.** Reuse a fresh `security/<head-sha>` report (or `.ai/logs/security-reviews/` file for this HEAD) when present; otherwise spawn `security-auditor` + `ethical-hacker` in parallel as in `--security`. Findings ≥ `security.severityFloor` gate the commit; below it → warnings. Manual cross-checks: no hardcoded secrets, input validation, no injection vectors, no silent failures.
4. **Verify issues are real:** run the specific tests, confirm type errors, check security concerns in context.
5. **Write** `.ai/logs/code-reviews/<branch-name>.md` (summary, files, findings CRITICAL / IMPORTANT / SUGGESTION with file:line, verdict PASS / PASS WITH SUGGESTIONS / NEEDS FIXES). **Artifact store:** `integrations.tracker.artifacts.store` decides placement — absent/`local` = that path; `orbit` = author it the same, `orbit_artifact_push` as kind `review` (with `local: scratch` the file is a spool deleted after the push); `both` = path and push. Warn-only: a failed push keeps the file and never blocks. Contract: `flow:orbit-backend`, [guide 06](../skills/orbit-backend/_guide-06-artifact-store.md).
6. **Simplifier pass.** On PASS / PASS WITH SUGGESTIONS spawn `code-simplifier` ("refactor `git diff --name-only HEAD` for clarity; honor CLAUDE.md and project rule skills; preserve behavior; skip tests, scenarios and DDR-flagged perf hot paths"). Skip when NEEDS FIXES, diff < ~30 lines, or pure config/infra.
7. **Recheck** after the simplifier: scoped lint/typecheck and the tests touching simplified files (as `--fast`). Anything broke → `git checkout -- <files>` to revert the simplifier, log under `## Simplifier outcome`, continue with pre-simplifier code. Clean → append `## Simplifier outcome` (files, lines +/-, note), re-read `git diff` for new findings, update the verdict.
8. **kgai** — after the recheck so the verdict is final: `maude kg record-log --file ".ai/logs/code-reviews/<branch-name>.md"` and the security report if one was written. With `artifacts.store: orbit` point `--file` at the scratch file, pass `--kind code-review`, and run it **before** the push (guide 06 §2b). Silent no-op when inactive.
9. **Close:** PASS → "Ready to commit?"; NEEDS FIXES → "Should I fix these issues?" and apply inline on yes.

## `--scenario [name | new <name>]` — cross-platform UI flow runner

Backbone of UI validation: every UI feature needs ≥ 1 scenario (5 platforms; web-only/native-only features use a subset). Wraps `agent-browser` + `agent-device`; protocol in the `scenario` skill, repo overrides in `paths.scenarioGuide` (default `.ai/scenario-guide.md`). Agent: `scenario-runner`. Empty argument → list `.ai/scenarios/` with last-run status.

**Existing scenario `<name>`:**
0. *Skip + scope (DDR-061, skill "Phase C speed levers").* `covers.json` present and covered files unchanged since the last green run (`scenario/<name>/<covers-sha>` cache) → reuse the cached report (`--force` re-runs). Diff touches only web pathspecs → run web variants only, native `skipped: web-only change`, don't boot sims.
1. *Pre-flight:* `agent-browser --version`, `agent-device --version`; boot sims/AVDs in the background (`xcrun simctl boot`, AVD start; Monitor `simctl bootstatus` / `adb wait-for-device`) unless web-only; find UDIDs/serials. Platforms without a booted device are **skipped** with a `result.txt` reason, not a whole-run fail.
2. *Run* per the skill: web variants (sequential among themselves), natives in parallel.
3. *Report:* `maude scenario-report ".ai/device/scenario-runs/<name>/<YYYY-MM-DD-HHMM>"` writes the tables; author only the two `<!-- LLM-AUTHORED -->` sections ("What surprised us", "Recommended follow-ups") and delete the comments.
4. Suggest: "Scenario `<name>` ran: X/Y pass. Report: `<path>`. Post to PR?"

**`new <name>`:** create `.ai/scenarios/<name>/{runners/,README.md}` (README: user flow steps, persona from the PRD, PRD screen reference, fixtures, expected end state); pilot interactively (`agent-device --save-script` records native); save one bash runner per platform; smoke-run it and commit the runners on 5/5.

Production-ready scenario: idempotent runners, testID/semantic selectors, identical counter-delta across platforms, missing testIDs become concrete follow-up tickets. `/flow:plan` acceptance criteria for UI tasks name a scenario; `/flow:done` requires a passing report (URL goes in the PR description).

Validate never commits, pushes or fixes — that's `/flow:done` and `/flow:execute`.
