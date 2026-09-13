---
name: quality-gates
category: shared
description: "Resolve project quality commands, scoped checks, gate failures and validation fallbacks from workflow config."
user-invocable: false
---

# Quality Gates

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Reference for the `quality` block in `.ai/workflows.config.json`. This skill documents a **data shape and a read pattern** — it is not an execution contract and defines no output format. The data IS a plain shell-command string; `eval` is the runner.

## 1. Shape — a flat map

`quality` is a flat map of gate name → shell-command string. No nesting, no per-gate object, no `order` array, no `scope`/`blocking` fields.

```jsonc
"quality": {
  "lint":      "pnpm lint",
  "format":    "pnpm biome format .",
  "typecheck": "pnpm exec tsc --noEmit -p apps/studio",
  "tests":     "pnpm test && pnpm test:dev-server",
  "build":     "pnpm --filter @maude/site build"
}
```

The block is **optional**. Populate it via `maude doctor --fix` (additive — never overwrites an existing user value).

## 2. Gate names

Conventional names: `lint`, `format`, `typecheck`, `tests`, `build`. These are conventions, not an enum — projects may add free-form gates (`accessibility`, `i18n`, …). Schema only enforces *value is a non-empty string*.

## 3. Read pattern (every consumer uses this)

```bash
LINT_CMD=$(jq -r '.quality.lint // empty' .ai/workflows.config.json)
if [[ -n "$LINT_CMD" ]]; then
  eval "$LINT_CMD" || { echo "::error::lint gate failed (\`$LINT_CMD\`)"; exit 1; }
else
  echo "⚠ quality.lint not declared — run \`maude doctor --fix\`"
fi
```

## 4. Missing gate → warn + skip, NEVER fabricate

If a gate key is absent, print a one-line warning pointing at `maude doctor --fix` and move on. Do not infer or invent a command. A declared gate that fails IS a blocker; an *undeclared* gate is not.

## 5. Inner loop vs outer gate — the posture split

Implementation commands (`/flow:utils-verify`, per-task `/flow:execute`, `/flow:bug-fix`, `/flow:quick`) **never run a repo-wide gate in the foreground**. The full `quality.*` pipeline runs exactly once, at the outer gate (`/flow:validate` / `/flow:done`). Rationale, measured (AI-StudyMate wiki-adoption-telemetry execution report, 2026-09-01): a repo-wide `typecheck` fanned out to 37 turbo projects, ran 16m15s, and was force-killed **without producing a verdict** — pure loss; the same gates then ran again at `/flow:done`. A repo-wide check mid-implementation can only slow the user down; it cannot make the merge safer than the outer gate already does.

During implementation the inner loop runs, per gate:

1. **`qualityScoped.<gate>` declared** → run it (blocker on fail).
2. **Not declared, gate is `format`/`lint`** → the command MAY run the `quality.<gate>` command constrained to changed files (`eval "$CMD -- $FILES"` — the same trick `/flow:quick` uses on staged files). If the tool ignores file args or `quality.<gate>` is absent → defer.
3. **Otherwise** → **defer**: print one line (`→ <gate>: no scoped gate declared — deferred to /flow:validate`) and move on. Never fall back to the repo-wide command; never fabricate a filter the user didn't declare.

## 6. `qualityScoped` — scoped gate variants

Top-level block, same flat shape as `quality` (gate name → shell command string, keys mirror `quality`). It exists **only** for the inner loop; `/flow:validate` ignores it entirely.

```jsonc
"qualityScoped": {
  "lint":      "turbo run lint --filter='[origin/main]'",
  "typecheck": "turbo run check-types --filter='[origin/main]'"
}
```

> **Why a separate block, not `lintScoped` keys inside `quality`:** `/flow:validate` Step 3.5 runs every non-conventional `quality.*` key as a blocking custom gate — a scoped key inside `quality` would run twice (inner loop + validate).

Read pattern is identical to §3 (`jq -r '.qualityScoped.<gate> // empty'` + `eval`). Missing key → defer per §5, not warn-and-run-something-else.

**Monorepo fan-out trap (document-worthy because the obvious fix is wrong):** Turborepo's `--filter='...[base]'` (changed **+ dependents**) looks like the correct scoping answer, but whenever a shared package is touched it selects nearly the whole monorepo (measured: 37 of 37 packages) — i.e. no speed-up for exactly the changes that need one. Scoped gates use changed-only `[base]`; dependent breakage is `/flow:validate`'s job before merge.

## 7. Affected tests — filter-sanity rule

When the inner loop runs "affected tests", verify the filter actually filtered: if the runner reports a file count near the full suite despite a pattern being passed, the pattern was swallowed — a common trap is a pattern landing after a bare `--` in a package script (e.g. `pnpm --filter X test -- <pattern>` with a `vitest run` script ignores it and runs everything; ~55 s instead of 1.2 s, measured). Switch to the runner's exec form (`pnpm --filter X exec vitest run <pattern>` or the project equivalent) and keep using it. A "full suite passed" line during a scoped run is a bug signal, not reassurance.

## 8. Which command reads which gate

| Command | Gates read | Posture |
| ------- | ---------- | ------- |
| `/flow:utils-verify` | `qualityScoped.{format,lint,typecheck}` (declared-only) + affected tests; undeclared `format`/`lint` may run `quality.*` on changed files via file args | Blocker when run; undeclared → defer to `/flow:validate` (§5) |
| `/flow:quick` | `qualityScoped.{format,lint}` if declared, else `quality.{format,lint}` staged-files-only | Blocker |
| `/flow:execute` (per task) / `/flow:bug-fix` | — delegate to `/flow:utils-verify` | — |
| `/flow:validate` | `format` → `lint` → `typecheck` → `tests` → `build` (in order, fail-fast) + custom `quality.*` gates; ignores `qualityScoped` | All blocker |
| `/flow:done` | — delegates to `/flow:validate` | — |
| `.ai/release-guide.md` pre-flight | every entry in `config.quality` | Blocker |

Config never enforces ordering or blocking — that is the calling command's opinion. Schema health for the `quality`/`qualityScoped` blocks (e.g. a non-string value) surfaces under `maude doctor`, not here.
