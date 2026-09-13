---
name: utils-verify
category: utils
type: command
description: "Verify touched files with scoped quality gates, affected tests and applicable UI smoke checks."
keywords: [verify, check, smoke, edit-verify, agent-browser, agent-device]
---

# /flow:utils-verify — focused check

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Use during `/execute` after each task (Edit-Verify Loop). For a full cross-platform sweep before merge, use `/validate`.

## Process

1. **Determine scope:**
   ```bash
   git diff --name-only             # uncommitted
   git diff --name-only main...HEAD # vs main
   ```
   Classify files:
   - `.ts/.tsx/.js/.jsx` source → static checks + browser smoke (if UI)
   - `.test.*` → run affected tests
   - `.css/styles` → static check + visual smoke (agent-browser screenshot)
   - RN files (`apps/mobile/`, `apps/native/`, etc.) → agent-device smoke
   - Pure backend / config → static checks only

2. **Static checks — scoped-only (`config.qualityScoped.*`) + affected tests:**

   > **Never run a repo-wide gate here.** The inner loop runs ONLY commands that are scoped to the change by construction — see the `flow:quality-gates` skill § "Inner loop vs outer gate". The full `quality.{format,lint,typecheck,tests,build}` pipeline is `/flow:validate`'s job, exactly once, before merge. A repo-wide check mid-implementation (measured: 16-minute monorepo typecheck, killed without a verdict) only slows the user down.

   Per gate `format`, `lint`, `typecheck`, resolve in this order:

   ```bash
   # Changed filenames are UNTRUSTED (a checked-out PR branch or codegen can plant
   # hostile names) — collect NUL-safe and shell-quote each one before any eval.
   CHANGED=""
   while IFS= read -r -d '' f; do CHANGED+="$(printf '%q' "$f") "; done \
     < <({ git diff -z --name-only --diff-filter=d; git diff -z --cached --name-only --diff-filter=d; } | sort -zu)
   for gate in format lint typecheck; do
     SCOPED=$(jq -r ".qualityScoped.$gate // empty" .ai/workflows.config.json)
     if [[ -n "$SCOPED" ]]; then
       echo "→ $gate (scoped): $SCOPED"
       eval "$SCOPED" || { echo "::error::$gate scoped gate failed (\`$SCOPED\`)"; exit 1; }
     elif [[ "$gate" != "typecheck" ]]; then
       # format/lint only: try the repo-wide command constrained to changed files.
       # Tools that ignore positional file args would silently scan everything — so
       # only run this form when the command visibly accepts file args; else defer.
       CMD=$(jq -r ".quality.$gate // empty" .ai/workflows.config.json)
       if [[ -n "$CMD" && -n "$CHANGED" ]]; then
         echo "→ $gate (changed files): $CMD -- $CHANGED"
         eval "$CMD -- $CHANGED" || { echo "::error::$gate gate failed on changed files"; exit 1; }
       else
         echo "→ $gate: no scoped gate declared — deferred to /flow:validate"
       fi
     else
       # typecheck has no generic file-args form (project-mode tsc ignores file args).
       echo "→ typecheck: no qualityScoped.typecheck declared — deferred to /flow:validate"
     fi
   done
   ```

   - **Affected tests** (only the tests touching changed files — never the full `quality.tests` suite). **Filter-sanity guard** (`flow:quality-gates` §7): after the run, check the reported test-file count — if it's near the full suite despite your pattern, the filter was swallowed (classic: `pnpm --filter X test -- <pattern>` lands the pattern after a bare `--` and vitest ignores it; ~55 s instead of 1.2 s). Switch to the runner's exec form (`pnpm --filter X exec vitest run <pattern>` or project equivalent) and keep using it for the rest of the session.
   - When the diff spans monorepo packages, scope by **changed packages only** (`[base]`), not changed-plus-dependents (`...[base]`) — the dependents-inclusive filter selects nearly the whole monorepo whenever a shared package is touched. Dependent breakage is `/flow:validate`'s job.

3. **UI smoke (parallel — fire only the legs the diff triggers):**

   Web smoke and native smoke are independent. **When the diff contains both web and native sources, run both legs in parallel in a single assistant message** (one Bash call for web, one for native); when only one applies, run just that one. Optional subagents (step 4) join the same parallel batch when their triggers fire.

   - **Web (diff contains web sources):**
     ```bash
     # Quick smoke — agent-browser, web-desktop only, < 30s
     agent-browser open http://localhost:4000/<route-relevant-to-task>
     agent-browser snapshot -c             # compact snapshot, context-cheap
     agent-browser screenshot .ai/device/verify/$(date +%s)-<task>.png
     ```
     - Verifies: page loads without crash, key elements from the plan are in the snapshot.
     - **Not** a full scenario — that's `/validate`. Here we catch obvious 500s, missing imports, runtime crashes.
   - **Native (diff contains RN sources):**
     ```bash
     IPHONE_UDID=$(xcrun simctl list devices booted -j | python3 -c "import json,sys;d=json.load(sys.stdin)['devices'];print(next((dev['udid'] for k,v in d.items() if 'iOS' in k for dev in v if 'iPhone' in dev['name']), ''))")
     agent-device --platform ios open com.<project>.<bundle> --udid $IPHONE_UDID
     agent-device snapshot -i              # accessibility snapshot
     agent-device screenshot .ai/device/verify/$(date +%s)-ios.png
     ```
     - Smoke = app starts, navigation to affected screen works, no red-screen / crash dialog.

4. **Subagents (optional, recommended for UI tasks) — add to the same parallel batch as step 3 when triggered:**
   - `a11y-auditor` — quick a11y check of affected UI files
   - `design-system-guard` — conformance with the project design system

5. **Report** — deferred gates are listed explicitly so it's never silently unclear what wasn't checked:
   ```
   ✓ lint (scoped): pass (3 files)
   → typecheck: deferred to /flow:validate (no qualityScoped.typecheck)
   ✓ tests: 5/5 pass (1 file — filter verified)
   ✓ web-desktop smoke: page loads, key elements present
   ⚠ a11y: 1 warning — Button on screen X missing accessible name
   ```

6. **Config drift nudge (soft, never blocks):**
   ```bash
   maude doctor --json | jq -e '(.summary.driftCount + .summary.qualityAdditions) == 0' >/dev/null \
     || echo "⚠ config drift / missing quality gates — run \`maude doctor --fix\` when convenient (not blocking)"
   ```
   A nudge only. Gate failures in Step 2 ARE blockers; this is not.

7. If something fails, propose a fix or return to the edit-verify loop in `/execute` (max 3 iterations per task).

## What /flow:utils-verify does NOT do

- **Repo-wide gates** — `quality.{format,lint,typecheck,tests,build}` run in `/flow:validate`, once. Undeclared scoped gate → defer, never fall back to the repo-wide command.
- Cross-platform parity check — that's a `/validate` job (spawn the `scenario-runner` subagent across 5 platforms).
- Full test suite (only affected tests, with the filter-sanity guard).
- Build of the whole project — only where directly touched.
- Bundle size / performance regression — that's `/validate`.

## Idiom

`/flow:utils-verify` is the **inner loop** during work. Run often, even after every edit. **Cheap by construction** — it only ever runs scoped commands, so the 15–60 s envelope holds regardless of repo size; anything that can't be scoped is deferred, not run.

`/validate` is the **outer gate** before merge. Run once before `/done`. **Expensive** (cross-platform scenario, full pipeline). Roughly 5–15 min depending on platform count.
