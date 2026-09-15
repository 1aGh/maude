---
name: init
category: setup
type: command
description: "Scaffold the .ai workspace, detect the project stack and check host instruction files and dependencies."
keywords: [init, setup, onboard, project, configure, bootstrap, scaffold, workspace, maude, mdcc, claude.md]
---

# /flow:init — Bootstrap the flow workspace

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

**Instruction-file selection:** bind `INSTRUCTIONS_FILE` to `CLAUDE.md` in
Claude Code or `AGENTS.md` in Codex before running the examples. Report and
recommend the selected filename. Do not require a Claude file in a Codex project.


Sets up everything the `flow` plugin needs to operate on a new (or existing) repo. Defers to the active host's built-in `/init` for its instruction file. Owns three things:

1. The `.ai/` second-brain workspace skeleton (scaffolded via `maude init`).
2. Populating `.ai/workflows.config.json` with detected stack values.
3. Recommending the host's `/init` for its instruction file if missing.

## Pre-Flight A: dependency check (sourced from manifest)

The dependency list (node, git, maude, agent-browser, agent-device, jq, …) is **not** a hardcoded `command -v` chain — it is sourced from `plugins/flow/dependencies.json` via the shared `preflight.mjs` lib (Task A14). Editing that manifest surfaces in the next `/flow:init` run with no change to this command.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PKG_ROOT="$(cd "$CLAUDE_PLUGIN_ROOT/../.." && pwd)"   # maude install root (holds plugins/flow/dependencies.json)
CACHE="$REPO_ROOT/.ai/state/_preflight.json"
mkdir -p "$REPO_ROOT/.ai/state"

# ── Cross-command short-circuit (Task A15) ────────────────────────────────
# Skip the dependency preflight if a sibling command already ran it this
# session: cache must be < 5 min old AND have all hard deps passing.
FRESH=$(node -e "try{const c=require('$CACHE');process.stdout.write(String(c.all_hard_pass===true && c.plugin==='flow' && Date.now()-Date.parse(c.checked)<300000))}catch{process.stdout.write('false')}")

if [[ "$FRESH" == "true" ]]; then
  echo "preflight cached (<5min, all hard deps pass) — skipping dependency check"
  DEPS_OK=1
  DEPS_MISSING="$(node -e "try{process.stdout.write((require('$CACHE').soft_warnings||[]).join(','))}catch{}")"
else
  # Reach preflight via the one contract (DDR-061): the sibling `cli/lib` when it
  # exists (running uncompiled from the repo), else the on-PATH `maude` binary —
  # the marketplace install copies the plugin alone, so there is NO sibling cli/.
  # maude is a SOFT dep for flow, so if NEITHER is available, degrade gracefully
  # (that absence is exactly what the preflight would report) rather than crash
  # with MODULE_NOT_FOUND on `cache/<mkt>/cli/lib/preflight.mjs`.
  if [ -f "$PKG_ROOT/cli/lib/preflight.mjs" ]; then
    ( cd "$PKG_ROOT" && node cli/lib/preflight.mjs --plugin flow --cache "$CACHE" )            # human table
    eval "$(cd "$PKG_ROOT" && node cli/lib/preflight.mjs --plugin flow --shell-export --cache "$CACHE")"
  elif command -v maude >/dev/null 2>&1; then
    maude preflight --plugin flow --cache "$CACHE"                                             # human table
    eval "$(maude preflight --plugin flow --shell-export --cache "$CACHE")"
  else
    echo "preflight: 'maude' not installed and no sibling cli/ — degraded mode (maude soft-missing)."
    DEPS_OK=1; DEPS_MISSING="maude"
  fi
  # Exposes: $DEPS_OK (1 if all HARD deps pass), $DEPS_MISSING (csv of missing ids).
fi

# maude is a soft dep — its absence flips degraded mode, never aborts.
if [[ ",$DEPS_MISSING," == *",maude,"* ]]; then
  MAUDE_AVAILABLE=false
else
  MAUDE_AVAILABLE=true
  MAUDE_VERSION="$(maude --version 2>/dev/null || echo 'unknown')"
fi
```

- **`$DEPS_OK == 0`** (a hard dep — node ≥ 20 / git — missing) → abort, surfacing the install hint the preflight table already printed.
- **`MAUDE_AVAILABLE=true`** → `> Found maude ($MAUDE_VERSION). Will scaffold .ai/ in Step 1.`
- **`MAUDE_AVAILABLE=false`** → `> maude not on PATH. Run \`npm i -g @1agh/maude\` then re-run /flow:init. Continuing in degraded mode — config-file population in Step 3 will be manual.`

## Pre-Flight B: host instruction file exists?

First select `CLAUDE.md` for Claude Code or `AGENTS.md` for Codex. In the
legacy examples below, substitute that selected filename; `/init` is the active
host's built-in command. If unavailable, explain the missing file and offer the
same concise initialization within the user's request. Do not invoke the other
host's CLI or copy a Claude instruction file with global name replacement.


```bash
if [[ -f "$REPO_ROOT/$INSTRUCTIONS_FILE" || ( "$INSTRUCTIONS_FILE" == "CLAUDE.md" && -f "$REPO_ROOT/.claude/CLAUDE.md" ) ]]; then
  INSTRUCTIONS_EXIST=true
else
  INSTRUCTIONS_EXIST=false
fi
```

- **Exists** → continue, will note it in Step 4 report.
- **Missing** → at the end, recommend the active host's `/init` for the selected instruction file. Keep the host-specific guidance in Step 5.

## Step 1: Scaffold `.ai/` via `maude init`

> Skip if `MAUDE_AVAILABLE=false`. Also skip silently if `.ai/workflows.config.json` already exists (idempotent — assume previous onboard handled it; Step 3 will still propagate fresh detected values).

Detect project name (user can override later):

```bash
PRE_NAME="$(basename "$REPO_ROOT")"
```

Run:

```bash
maude init --name "$PRE_NAME"
```

After this:

- `.ai/` has every subfolder (`plans/`, `decisions/`, `reviews/`, `scenarios/`, `logs/`, `context/`, `business/`, `docs/`, `state/`, `templates/`, …).
- `.ai/workflows.config.json` exists with sensible defaults and `name: "$PRE_NAME"`.

### Step 1.5: Offer the knowledge-graph backend (optional)

`maude init` scaffolds the **classic** file-based workspace. If the `kg` CLI is on this machine, the project can instead use the kgai knowledge graph as its decision + history authority — decisions, RCAs and review verdicts become queryable (`maude kg search "<topic>"`) instead of grep-over-markdown, and the gitignored `.ai/logs/**` verdicts gain an inheritable copy.

```bash
command -v kg >/dev/null 2>&1 && echo "kg present" || echo "kg absent"
```

- **`kg` absent** → say nothing and move on. Don't advertise a tool the user would have to go install; `mode:auto` means the workspace picks it up automatically if they ever do.
- **`kg` present** → ask once:

  > **`kg` is installed here. Use the knowledge graph as this project's decision memory?** It replaces `.ai/state/STATE.md` history and `.ai/decisions/*.md` with a queryable graph (the markdown stays as the authoring surface). Everything still works without it. [y/N]

  On **yes**: re-run with `--kg`, then initialize the store.

  ```bash
  maude init --name "$PRE_NAME" --kg --force
  kg init
  maude kg doctor          # confirm: active
  ```

  `--kg` writes a thin `STATE.md` pointer-stub instead of the full template (the graph is the history authority) and adds the `knowledgeGraph` block to `workflows.config.json`. On **no**, change nothing — the absent block means `mode:auto`, so it stays dormant and every command runs its classic path.

**Migrating an existing repo is a different command** — `/flow:migrate-kgai` (or `maude kg import`) ingests decisions and log verdicts that are already on disk. `--kg` here only configures a fresh workspace.

## Step 2: Auto-detect the stack

Run detection — collect into shell variables for Step 3.

```bash
# Identity
REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo '')"
ORG="$(echo "$REMOTE_URL" | sed 's|.*github.com[:/]||;s|/.*||')"
REPO_NAME="$(echo "$REMOTE_URL" | sed 's|.*github.com[:/]||;s|\.git$||;s|.*/||')"

# Package manager
if   [[ -f "$REPO_ROOT/pnpm-lock.yaml" ]];    then PM="pnpm"
elif [[ -f "$REPO_ROOT/yarn.lock" ]];          then PM="yarn"
elif [[ -f "$REPO_ROOT/package-lock.json" ]];  then PM="npm"
elif [[ -f "$REPO_ROOT/Cargo.toml" ]];         then PM="cargo"
elif [[ -f "$REPO_ROOT/go.mod" ]];             then PM="go"
elif [[ -f "$REPO_ROOT/pyproject.toml" || -f "$REPO_ROOT/requirements.txt" ]]; then PM="pip"
elif [[ -f "$REPO_ROOT/pom.xml" ]];            then PM="maven"
elif [[ -f "$REPO_ROOT/build.gradle" || -f "$REPO_ROOT/build.gradle.kts" ]]; then PM="gradle"
else PM="unknown"
fi

# Language
if   [[ -f "$REPO_ROOT/tsconfig.json" ]];      then LANG="typescript"
elif [[ -f "$REPO_ROOT/Cargo.toml" ]];         then LANG="rust"
elif [[ -f "$REPO_ROOT/go.mod" ]];             then LANG="go"
elif [[ -f "$REPO_ROOT/pyproject.toml" || -f "$REPO_ROOT/requirements.txt" ]]; then LANG="python"
elif [[ -f "$REPO_ROOT/pom.xml" || -f "$REPO_ROOT/build.gradle" || -f "$REPO_ROOT/build.gradle.kts" ]]; then LANG="java"
elif [[ -f "$REPO_ROOT/package.json" ]];       then LANG="javascript"
else LANG="unknown"
fi

# Framework heuristic
FRAMEWORK="unknown"
[[ -f "$REPO_ROOT/next.config.js" || -f "$REPO_ROOT/next.config.ts" || -f "$REPO_ROOT/next.config.mjs" ]] && FRAMEWORK="next.js"
[[ -f "$REPO_ROOT/vite.config.js" || -f "$REPO_ROOT/vite.config.ts" ]] && FRAMEWORK="vite"
[[ -f "$REPO_ROOT/app.json" || -f "$REPO_ROOT/app.config.js" || -f "$REPO_ROOT/app.config.ts" ]] && FRAMEWORK="expo"
[[ -f "$REPO_ROOT/svelte.config.js" ]] && FRAMEWORK="sveltekit"
[[ -f "$REPO_ROOT/remix.config.js" ]] && FRAMEWORK="remix"
[[ -f "$REPO_ROOT/astro.config.mjs" ]] && FRAMEWORK="astro"
[[ -f "$REPO_ROOT/nuxt.config.ts" || -f "$REPO_ROOT/nuxt.config.js" ]] && FRAMEWORK="nuxt"

# Monorepo + build tool
MONOREPO="false"
BUILD_TOOL="none"
if   [[ -f "$REPO_ROOT/turbo.json" ]];           then MONOREPO="true"; BUILD_TOOL="turbo"
elif [[ -f "$REPO_ROOT/nx.json" ]];              then MONOREPO="true"; BUILD_TOOL="nx"
elif [[ -f "$REPO_ROOT/lerna.json" ]];           then MONOREPO="true"; BUILD_TOOL="lerna"
elif [[ -f "$REPO_ROOT/rush.json" ]];            then MONOREPO="true"; BUILD_TOOL="rush"
elif [[ -f "$REPO_ROOT/pnpm-workspace.yaml" ]];  then MONOREPO="true"
elif [[ -f "$REPO_ROOT/Makefile" ]];             then BUILD_TOOL="make"
elif [[ -f "$REPO_ROOT/BUILD.bazel" || -f "$REPO_ROOT/WORKSPACE" ]]; then BUILD_TOOL="bazel"
fi

# CI
if   [[ -d "$REPO_ROOT/.github/workflows" ]];   then CI="github-actions"
elif [[ -f "$REPO_ROOT/.gitlab-ci.yml" ]];      then CI="gitlab-ci"
elif [[ -f "$REPO_ROOT/Jenkinsfile" ]];         then CI="jenkins"
elif [[ -f "$REPO_ROOT/azure-pipelines.yml" ]]; then CI="azure-devops"
elif [[ -f "$REPO_ROOT/.circleci/config.yml" ]]; then CI="circleci"
elif [[ -f "$REPO_ROOT/bitbucket-pipelines.yml" ]]; then CI="bitbucket"
else CI="unknown"
fi

# Test runner — read from package.json devDependencies if present
TESTS="unknown"
if [[ -f "$REPO_ROOT/package.json" ]]; then
  if   grep -q '"vitest"'      "$REPO_ROOT/package.json"; then TESTS="vitest"
  elif grep -q '"jest"'        "$REPO_ROOT/package.json"; then TESTS="jest"
  elif grep -q '"@playwright/test"' "$REPO_ROOT/package.json"; then TESTS="playwright"
  elif grep -q '"cypress"'     "$REPO_ROOT/package.json"; then TESTS="cypress"
  fi
fi
[[ -f "$REPO_ROOT/go.mod" ]]     && TESTS="go-test"
[[ -f "$REPO_ROOT/Cargo.toml" ]] && TESTS="cargo-test"
[[ -f "$REPO_ROOT/pytest.ini" || -f "$REPO_ROOT/pyproject.toml" ]] && grep -q "pytest" "$REPO_ROOT/pyproject.toml" 2>/dev/null && TESTS="pytest"

# CSS approach
CSS="unknown"
if [[ -f "$REPO_ROOT/package.json" ]]; then
  if   grep -q '"tailwindcss"' "$REPO_ROOT/package.json"; then CSS="tailwind"
  elif grep -q '"styled-components"' "$REPO_ROOT/package.json"; then CSS="styled-components"
  elif grep -q '"@emotion/' "$REPO_ROOT/package.json"; then CSS="emotion"
  elif grep -q '"@vanilla-extract/' "$REPO_ROOT/package.json"; then CSS="vanilla-extract"
  elif [[ -f "$REPO_ROOT/postcss.config.js" || -f "$REPO_ROOT/postcss.config.cjs" ]]; then CSS="css-modules"
  fi
fi

# Router (web framework dependent)
ROUTER="unknown"
case "$FRAMEWORK" in
  next.js)   [[ -d "$REPO_ROOT/app" || -d "$REPO_ROOT/src/app" ]] && ROUTER="next-app" || ROUTER="next-pages" ;;
  remix)     ROUTER="react-router" ;;
  sveltekit) ROUTER="sveltekit-router" ;;
  expo)      ROUTER="expo-router" ;;
esac
[[ "$ROUTER" == "unknown" && -f "$REPO_ROOT/package.json" ]] && grep -q '"@tanstack/router' "$REPO_ROOT/package.json" && ROUTER="tanstack-router"
[[ "$ROUTER" == "unknown" && -f "$REPO_ROOT/package.json" ]] && grep -q '"react-router' "$REPO_ROOT/package.json" && ROUTER="react-router"

# Commit convention
COMMITS="conventional"
ls "$REPO_ROOT"/commitlint.config.* &>/dev/null || COMMITS="free-form"
[[ -f "$REPO_ROOT/.gitmoji-changelogrc" ]] && COMMITS="gitmoji"

# Tracker hint — does this repo have a GitHub remote?
TRACKER_HINT="none"
[[ "$REMOTE_URL" == *github.com* ]] && TRACKER_HINT="github"

# Changelog provider hint — auto-detect from filesystem markers.
# Order matters: most specific marker wins.
CHANGELOG_PROVIDER="none"
[[ -f "$REPO_ROOT/.changeset/config.json" ]] && CHANGELOG_PROVIDER="changesets"
[[ "$CHANGELOG_PROVIDER" == "none" && ( -f "$REPO_ROOT/cliff.toml" || -f "$REPO_ROOT/.git-cliff.toml" ) ]] && CHANGELOG_PROVIDER="git-cliff"
[[ "$CHANGELOG_PROVIDER" == "none" && "$COMMITS" == "conventional" && -f "$REPO_ROOT/CHANGELOG.md" ]] && CHANGELOG_PROVIDER="conventional"
```

## Step 2b: Resolve tech-stack skills

> Runs **after** auto-detect (Step 2) so the detected stack is the input — and **before** we propagate values to `workflows.config.json` (Step 4), so any decisions captured there can lean on real library knowledge.

Invoke `Skill(flow:skill-loader)` with the detected stack as input (framework, language, ORM, CSS approach, plus any non-trivial dependency from `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`). The skill will:

1. Diff each material dependency against skills already loaded in this session.
2. For each gap, fetch the matching skill via the `terminal-skills` MCP (or fall back to WebFetch on official docs).
3. Persist the resolved set in `.ai/state/STATE.md` so future sessions in this repo don't re-resolve.

Onboarding is the one-shot moment to do this thoroughly — every later command (`/flow:plan`, `/flow:execute`) only patches gaps incrementally.

## Step 2c: Test runner recommendation (when detection failed)

> Runs only when `$TESTS == "unknown"` **and** the repo has source files (i.e. not a fresh empty repo). Skip otherwise — `/flow:init` doesn't scaffold runners, only surfaces the gap.

The flow plugin assumes a working test command exists — `/flow:utils-verify`, `/flow:validate`, and the testing-rules iron law all depend on it. When detection turns up nothing, surface a stack-appropriate recommendation **before** Step 3 asks the user, so the question has a real default to pre-fill:

```bash
TESTS_RECOMMENDED=""
TESTS_RUNNER_HINT=""

if [[ "$TESTS" == "unknown" ]]; then
  case "$LANG" in
    typescript|javascript)
      case "$FRAMEWORK" in
        next.js|remix|sveltekit|nuxt|astro) TESTS_RECOMMENDED="vitest"
          TESTS_RUNNER_HINT="vitest (fast, ESM-native, plays well with $FRAMEWORK) — install: $PM add -D vitest @vitest/coverage-v8" ;;
        expo)                                TESTS_RECOMMENDED="jest"
          TESTS_RUNNER_HINT="jest with jest-expo preset — install: $PM add -D jest jest-expo @testing-library/react-native" ;;
        vite)                                TESTS_RECOMMENDED="vitest"
          TESTS_RUNNER_HINT="vitest (native Vite integration) — install: $PM add -D vitest" ;;
        *)                                   TESTS_RECOMMENDED="vitest"
          TESTS_RUNNER_HINT="vitest is the modern default; jest if you need React Native or legacy compatibility" ;;
      esac ;;
    python)   TESTS_RECOMMENDED="pytest"
              TESTS_RUNNER_HINT="pytest with pytest-cov — install: pip install pytest pytest-cov (or add to pyproject.toml)" ;;
    go)       TESTS_RECOMMENDED="go-test"
              TESTS_RUNNER_HINT="built-in: \`go test ./...\` — no install needed; add -coverprofile for coverage" ;;
    rust)     TESTS_RECOMMENDED="cargo-test"
              TESTS_RUNNER_HINT="built-in: \`cargo test\` — no install needed" ;;
    java|kotlin) TESTS_RECOMMENDED="junit"
                 TESTS_RUNNER_HINT="JUnit 5 (Jupiter) — add via $BUILD_TOOL config" ;;
    *)        TESTS_RECOMMENDED="none"
              TESTS_RUNNER_HINT="No stack-specific recommendation — pick a runner that matches your language" ;;
  esac
fi
```

Print a one-line nudge — **never auto-install, never scaffold a config file**:

```
⚠ No test runner detected. flow:utils-verify and flow:validate both assume one exists.
  Recommendation for $LANG/$FRAMEWORK: $TESTS_RUNNER_HINT
  Step 3 will let you confirm or pick a different runner. To skip the gate entirely, answer `none`
  (flow:testing-rules will be effectively inert until a runner is added).
```

This is intentionally a recommendation, not a scaffold. Test runner choice is opinionated per project (vitest vs jest, pytest vs unittest, …) and per team. The plugin's job here is to make the absence visible, not to pick for them.

Ask for these — everything else has a sensible auto-detected or default value:

**Always ask:**

1. **Project name** (kebab-case, pre-filled with `$PRE_NAME`).
2. **Language for plan / DDR prose** (`en` | `cs` | other ISO 639-1). Pre-fill `en`.
3. **Theme target** — `dark` | `light` | `agnostic`. Pre-fill `agnostic`.
4. **Tracker provider** — pre-fill with `$TRACKER_HINT`. Options: `github` | `clickup` | `linear` | `jira` | `notion` | `asana` | `shortcut` | `orbit` | `none`. For `orbit`, also ask for its **base URL** (`maude config set integrations.tracker.baseUrl "<url>"`); the MCP wiring and token are covered by the `flow:orbit-backend` resolver.
5. **Branching model** — `github-flow` | `trunk-based` | `gitflow` | `release-branch`. Can't be reliably auto-detected; pre-fill `github-flow` as the most common.
6. **Prohibited packages / libraries** — comma-separated list, or `none`. Example: `lodash` (we use native ES), `moment` (we use date-fns), `axios` (we use fetch).
7. **Changelog provider** — pre-fill with `$CHANGELOG_PROVIDER`. Options: `changesets` | `git-cliff` | `conventional` | `custom` | `none`. Auto-detected from `.changeset/config.json` (changesets), `cliff.toml` / `.git-cliff.toml` (git-cliff), or `CHANGELOG.md` + conventional commits (conventional). If the monorepo signals at Step 2 are true (`$MONOREPO == "true"`), also ask for an optional **package scope** (e.g. `@1agh/maude`) — passed to `/flow:release-changelog` when authoring entries.

**Ask only when detection failed (`unknown`):**

- Framework (only if `$FRAMEWORK="unknown"`)
- Language (only if `$LANG="unknown"`)
- Test runner (only if `$TESTS="unknown"`) — pre-fill with `$TESTS_RECOMMENDED` from Step 2c, include `$TESTS_RUNNER_HINT` as the question subtitle so the user has install context inline. Accept `none` as a valid answer (records the gap; downstream gates degrade gracefully).
- CSS approach (only if `$CSS="unknown"` and the project ships UI)

For everything else (boundaries, motion ceilings, density map, bilingual, breakpoints, …) — leave defaults. The user tunes later via `maude config set` once the project shape clarifies.

## Step 3.5: Drift check (only when re-running on existing config)

> Skip entirely if `.ai/workflows.config.json` did **not** exist before Step 1 (fresh onboard — Step 4 writes everything from detection, nothing to reconcile).

Re-running `/flow:init` after a stack change (JS → TS, added a framework, switched test runner) should propagate the change **without** clobbering values the user hand-tuned later (`prohibited`, `boundaries`, `motion` ceilings, density map). Step 4's setters are blind overwrites, so gate them behind a per-key prompt first.

```bash
maude doctor --json > /tmp/flow-init-doctor.json
```

Parse the `config.drift` + `config.qualityAdditions` arrays:

- **For each stack drift row** (`{ key, declared, detected }`):
  - If `declared` is `"unknown"` / `""` / `null` / `"(unset)"` → silently apply detected (no real value to protect).
  - Else (declared disagrees with a concrete detected value) → ask: `keep declared <X>  |  apply detected <Y>  |  skip this key`. **Default = keep.**
- **For each quality addition** (`{ gate, command }`) → ask: `add quality.<gate>: "<command>"  |  skip`. **Default = add** (additive, no overwrite risk).

Apply the chosen overrides via `maude config set` (e.g. `maude config set stack.language typescript`, `maude config set quality.lint "pnpm lint"`).

> **Never** in the drift list: `prohibited`, `boundaries`, `motion` ceilings, `responsive.densityMap`. The detector doesn't touch them, so a re-run can **never** eat a tuned value — re-running `/flow:init` is safe.

Schema-error keys (e.g. an invalid `stack.tests` enum) are **not** auto-fixed here — `maude doctor` flags them; the user picks the migration target.

## Step 4: Propagate detected + answered values to `workflows.config.json`

> Skip if `MAUDE_AVAILABLE=false`. On a **re-run** (config already existed), Step 3.5 already reconciled stack + quality drift interactively — in that case Step 4 only writes the freshly-*answered* identity/convention values, not the blind stack overwrites (those went through the keep/apply/skip gate).

### 4a. Identity & top-level

```bash
maude config set name "$ANSWER_NAME"
maude config set language "$ANSWER_LANGUAGE"
maude config set theme "$ANSWER_THEME"
maude config set integrations.tracker.provider "$ANSWER_TRACKER"
maude config set integrations.changelog.provider "$ANSWER_CHANGELOG"
maude config set integrations.changelog.releaseGuide ".ai/release-guide.md"
[[ -n "$ANSWER_CHANGELOG_SCOPE" ]] && maude config set integrations.changelog.scope "$ANSWER_CHANGELOG_SCOPE"
```

### 4b. Stack snapshot

```bash
maude config set stack.language       "$LANG"
maude config set stack.framework      "$FRAMEWORK"
maude config set stack.packageManager "$PM"
maude config set stack.buildTool      "$BUILD_TOOL"
maude config set stack.monorepo       "$MONOREPO"
maude config set stack.ci             "$CI"
maude config set stack.tests          "$TESTS"
maude config set stack.css            "$CSS"
maude config set stack.router         "$ROUTER"
```

> `$MONOREPO` is `"true"`/`"false"` (string). The config setter parses `JSON.parse` so it stores as a boolean.

### 4c. Conventions

```bash
maude config set conventions.branchingModel "$ANSWER_BRANCHING"
maude config set conventions.commits        "$COMMITS"
maude config set conventions.prohibited     '<json-array-from-answer>'   # e.g. '["lodash","moment"]'
```

### 4d. Platforms (inferred from framework)

| Framework | Inferred `platforms` |
| --------- | --------------------- |
| `next.js` / `vite` / `remix` / `sveltekit` / `astro` / `nuxt` | `["web-desktop", "web-mobile"]` |
| `expo` | `["ios-phone", "android-phone"]` |
| `expo` + web framework in same repo (monorepo with both signals) | `["web-desktop", "web-mobile", "ios-phone", "android-phone"]` |
| API-only (Spring Boot / Django / Rails / Express alone) | `[]` |
| `unknown` | `["web-desktop"]` (safe default) |

```bash
maude config set platforms '<inferred-json-array>'
```

If the framework is `expo`, also try to pluck `bundleIdPrefix` from `app.json` / `app.config.*`:

```bash
# Example: extract "com.acme.app" → "com.acme"
BUNDLE_ID="$(jq -r '.expo.ios.bundleIdentifier // .expo.android.package // empty' "$REPO_ROOT/app.json" 2>/dev/null)"
if [[ -n "$BUNDLE_ID" ]]; then
  PREFIX="$(echo "$BUNDLE_ID" | awk -F. 'NF>=2 {OFS="."; NF--; print}')"
  maude config set bundleIdPrefix "$PREFIX"
fi
```

### 4f. Scaffold the release runbook

If `$ANSWER_CHANGELOG != "none"` and `.ai/release-guide.md` doesn't already exist, the runbook was already scaffolded by `maude init` in Step 1 (when invoked with `--provider`). If Step 1 ran without `--provider` (legacy path), re-emit it now:

```bash
if [[ "$ANSWER_CHANGELOG" != "none" && ! -f "$REPO_ROOT/.ai/release-guide.md" ]]; then
  maude init --name "$ANSWER_NAME" --provider "$ANSWER_CHANGELOG" --force
fi
```

If `$ANSWER_CHANGELOG == "none"` and no runbook exists, **skip** — the user can re-run `/flow:init` later (or create the file manually) once they pick a provider. Leave a one-line note in the Step 6 report so the gap is visible.

### 4e. What we DON'T touch

- `motion`, `responsive.densityMap`, `responsive.breakpoints`, `boundaries`, `ux`, `skills` — these are intentional choices the user makes after the project starts taking shape. Plugin skills work with defaults until the user tunes them.
- `paths.prd` / `paths.designSystem` — derived from `name` at command-read time; no need to write explicitly.

## Step 5: instruction-file handoff

If `INSTRUCTIONS_EXIST=true`, skip the prompt and note the file in the report.
Otherwise recommend the active host's `/init`: `CLAUDE.md` in Claude Code,
`AGENTS.md` in Codex. Then re-run `flow:status` to check the workflow setup.
Claude may use `.claude/rules/*.md` for path-scoped rules; Codex uses nested
`AGENTS.md` files. Optional `CLAUDE_CODE_NEW_INIT` applies only to Claude;
never set it as a prerequisite for Codex. Read `flow:claude-md-keeper` when
proposing subsequent convention updates.

## Step 6: Report

```
✓ /flow:init complete

Workspace
  .ai/ skeleton:               <scaffolded | already present | skipped (no maude)>
  .ai/workflows.config.json:   <created | updated | skipped>

Identity
  name:                        $ANSWER_NAME
  language:                    $ANSWER_LANGUAGE
  theme:                       $ANSWER_THEME
  platforms:                   $INFERRED_PLATFORMS
  bundleIdPrefix:              $PREFIX (if applicable)

Stack snapshot
  language:                    $LANG
  framework:                   $FRAMEWORK
  package manager:             $PM
  build tool:                  $BUILD_TOOL
  monorepo:                    $MONOREPO
  CI:                          $CI
  tests:                       $TESTS  (recommended on detect-fail: $TESTS_RECOMMENDED)
  CSS:                         $CSS
  router:                      $ROUTER

Conventions
  branching:                   $ANSWER_BRANCHING
  commits:                     $COMMITS
  prohibited:                  $ANSWER_PROHIBITED (or 'none')

Integrations
  tracker.provider:            $ANSWER_TRACKER
  changelog.provider:          $ANSWER_CHANGELOG
  changelog.scope:             $ANSWER_CHANGELOG_SCOPE (if monorepo)
  release-guide:               .ai/release-guide.md <scaffolded | skipped (provider = none)>
  (configure mcp + defaults via `maude config set integrations.<key>.*`)

<instruction file>
  status:                      <present at <path> | missing — run /init>

Next steps
  1. <if instruction file missing> Run the active host's /init for this stack.
  2. <if $ANSWER_TESTS == "none" and repo has source> Install a test runner — recommendation from Step 2c: $TESTS_RUNNER_HINT. Without one, /flow:utils-verify and /flow:validate skip their test gates.
  3. <if repo has source and $TESTS != "none"> (Optional) Spawn the `flow:test-coverage` subagent in `path <critical-dir>` mode — establish a baseline gap report for legacy untested code.
  4. Create .ai/$ANSWER_NAME-prd.md with your product brief.
  5. (Optional) Create .ai/$ANSWER_NAME-design-system.md.
  6. /flow:status — see where you are.
  7. /flow:plan <feature> — start working.
```

## Notes for plugin authors

- Keep instruction-file initialization with the active host; this command owns the `.ai/` workflow workspace.
- Keep shared session conventions in the host instruction file; structured workflow settings stay in `.ai/workflows.config.json` and load on demand.
- For project-level rules that don't need to be in every session (e.g. "frontend components must use shadcn/ui"), use `.claude/rules/<topic>.md` with `paths:` frontmatter — Anthropic's path-scoped rules system loads them only when relevant.
- This command is idempotent. Safe to re-run. Each step skips work if it's already done.
