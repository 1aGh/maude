---
name: quick
category: daily
type: command
description: "Implement a trivial change with focused verification and an authorized commit."
keywords: [quick, fast, trivial, small, hotfix, one-liner, shortcut]
---

# Quick: Fast-Path for Trivial Changes

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

## Objective

Skip the full intake → plan → execute cycle for small, obvious changes that don't need a plan. Go straight to edit → verify → commit.

## When to Use

All of the following must be true:

- **≤3 files** changed
- **Single package** (not cross-package)
- **No new patterns** introduced (follows existing conventions)
- **No new dependencies** added

If any criterion fails, redirect:

> This change is too complex for `quick`. Use `plan-feature` instead.

## Guardrails — Hard Limits

**Never** use `quick` for:

- New pages, routes, or API endpoints
- New dependencies (`pnpm add`, `npm install`)
- Cross-package changes in a monorepo
- Database schema changes
- Changes that affect CI/CD configuration
- Security-sensitive changes (auth, permissions, secrets)
- Changes that need a release-note entry (per `integrations.changelog.provider`) — `/flow:quick` skips changelog authoring; route through `/flow:plan` instead, or run `/flow:release-changelog` post-merge.

If the change falls into any of these categories, stop and redirect to `plan-feature`.

## Package Manager Auto-Detection

> This command uses `<pm>` as a placeholder for your package manager. Detect it:
>
> - `pnpm-lock.yaml` → `pnpm`
> - `yarn.lock` → `yarn`
> - `package-lock.json` → `npm run`

## Process

### 1. Confirm Triviality

Before making any changes, verify the criteria:

1. Ask the user to describe the change in one sentence
2. Check: Does it touch ≤3 files?
3. Check: Is it in a single package?
4. Check: Does it add new dependencies?
5. Check: Does it introduce a new pattern?

If any check fails → redirect to `plan-feature`.

### 1.5 Load-bearing tripwire (optional — `orchestration.mode`)

The dangerous "quick" change is the one that *looks* trivial but isn't. Read `orchestration.*` from `.ai/workflows.config.json` (DDR-130; **opt-out** — absent → `auto`, ON by default). Unless `mode:off`, run the **`flow:debate-protocol`** stakes-gate: if the change smells **load-bearing** — touches auth, data / migrations, a shared module, a public API, or anything on the §Guardrails list — escalate a cheap **2-seat tripwire** (`flow:breaker` + the `relay`-tier dissent when native agent-teams are available) asking "is this actually trivial?".

- Tripwire says **load-bearing** → stop and redirect to `/flow:plan` (it deserves the full divergent debate), or surface the risk and let the user decide.
- Tripwire **clears** (or `mode:off`) → proceed to Step 2 solo, **unchanged**.

Escalate-only: a genuinely trivial change pays ≈ one classification call, no team. This is the ONE place a per-iteration-style command touches the debate layer, and only as a guard — never a full ensemble.

### 2. Make the Change

Edit the file(s) directly — no plan file needed.

Follow existing conventions in the codebase:

- Match naming patterns
- Match import style
- Match test patterns (if adding/modifying tests)

### 3. Verify

Run the two fast quality gates on **staged files only** (`format` + `lint`, per the `flow:quality-gates` skill § "Inner loop vs outer gate"). Full `typecheck` / `tests` / `build` belong to `/flow:validate` — `quick` stays fast. When the project declares `qualityScoped.format` / `qualityScoped.lint`, prefer those over the staged-file-args heuristic below (they're scoped by construction).

```bash
# Staged filenames are untrusted input — collect NUL-safe, shell-quote before eval.
STAGED=""
while IFS= read -r -d '' f; do STAGED+="$(printf '%q' "$f") "; done \
  < <(git diff -z --cached --name-only --diff-filter=d)
[[ -z "$STAGED" ]] && { echo "no staged files — nothing to verify"; exit 0; }
for gate in format lint; do
  SCOPED=$(jq -r ".qualityScoped.$gate // empty" .ai/workflows.config.json)
  if [[ -n "$SCOPED" ]]; then
    echo "→ $gate (scoped): $SCOPED"
    eval "$SCOPED" || { echo "::error::$gate scoped gate failed (\`$SCOPED\`)"; exit 1; }
    continue
  fi
  CMD=$(jq -r ".quality.$gate // empty" .ai/workflows.config.json)
  if [[ -n "$CMD" ]]; then
    echo "→ $gate (staged): $CMD"
    # Pass staged files as args; gates that ignore positional args scan all — gate's choice.
    eval "$CMD -- $STAGED" 2>/dev/null || eval "$CMD" || { echo "::error::$gate gate failed (\`$CMD\`)"; exit 1; }
  else
    echo "⚠ quality.$gate not declared — run \`maude doctor --fix\` (skipping)"
  fi
done
```

Then run `/flow:utils-verify` for the affected-tests + smoke portion.

### 4. Handle Results

**If verify passes:**

Run the commit flow — read and follow `.claude/commands/commit.md`.

**If verify fails:**

Offer two options:

1. **Fix and retry** — apply fix, re-run verify (max 3 attempts)
2. **Escalate** — the change is more complex than expected; redirect to `plan-feature`

## Output

After completion:

```
⚡ Quick change complete.

  Files:  <list of changed files>
  Verify: ✅ passed
  Commit: <commit hash> <commit message>
```
