# Flow command categories

> **The canonical catalog.** Every `/flow:*` command belongs to exactly one group. New commands declare membership through their `category:` frontmatter field and follow the naming convention below.

## Naming convention

| Type | Pattern | Examples |
| ---- | ------- | -------- |
| **Daily** (called every feature cycle) | terse verb, no prefix | `plan`, `execute`, `done`, `validate`, `release` |
| **Everything else** | `<group>-<verb>` | `bug-fix`, `setup-prd`, `record-ddr`, `maintain-clean` |
| **Recognized bootstrap verb** | bare verb, no group prefix | `init` (mirrors Claude Code's built-in `/init`) |

Rules:

1. The `category:` frontmatter field must match one of the nine groups below.
2. Non-daily filenames **must** start with the group name + dash (the bare verb `init` is the lone exception). The `name:` frontmatter field is the **bare** slug — `<filename-sans-md>` (e.g. `bug-fix`, `record-ddr`), with no `flow:` prefix. Claude Code namespaces it to `flow:bug-fix` / `flow:record-ddr` itself at registration (per [DDR-191](../../.ai/archive/decisions/DDR-191-revert-plugin-name-prefix-claude-code-now-namespaces.md) — superseding the older [DDR-006](../../.ai/archive/decisions/DDR-006-plugin-namespace-in-name-frontmatter.md), which had us prefix it by hand as a workaround for a since-fixed Claude Code bug; doing that today stutters the namespace twice in autocomplete).
3. Slash-command namespacing via subdirectories is **not supported by Claude Code** ([issue #2422](https://github.com/anthropics/claude-code/issues/2422), [open feature request #44678](https://github.com/anthropics/claude-code/issues/44678)). Claude Code's own `flow:` namespacing (added at registration, not written in `name:`) is the working substitute — typing `/flow:bug-` then narrows autocomplete to `bug-rca` + `bug-fix`.
4. Claude Code's native `/help` lists every `/flow:*` command.

## Groups

Since the flow refactor (v1.10) the plugin keeps **ten** commands. Everything else was folded into one of them as a flag or lane; the old names were removed in the same release (Michal's call — 30-day census: 0–2 uses each); the history below maps old to new.

### daily — every-cycle workflow

| Command | Description | Absorbed |
| ------- | ----------- | -------- |
| `/flow:plan` | Context-rich feature plan; `--prd` writes a PRD with phase plans. Debate bookend (DDR-130). | setup-prd |
| `/flow:execute` | Execute a plan, handing each task to a fresh `flow:worker`; `--quick` for one small change without a plan. | quick |
| `/flow:validate` | Full gate pipeline; lanes `--fast`, `--security` (adversarial bookend), `--a11y`, `--visual`, `--review`, `--scenario`. | utils-verify, validate-*, review-code, scenario |
| `/flow:done` | Validate → decisions → review → commit → PR → report and retro → archive. | record-execution, record-retro |
| `/flow:release` | Walk the release runbook with a confirmation per step; `--changelog` authors the entry. | release-changelog |
| `/flow:run` | Run a plan unattended as a goal (opt-in, capped Stop gate); `--status`, `--pause`, `--resume`, `--stop`. | pause, resume, status |

### setup — one-shot bootstrapping

| Command | Description | Absorbed |
| ------- | ----------- | -------- |
| `/flow:init` | Scaffold `.ai/`, detect the stack, check dependencies; `--context`, `--map`, `--kgai` as idempotent steps. | setup-context, setup-codebase-map, migrate-kgai |

### bug — incident workflow

| Command | Description |
| ------- | ----------- |
| `/flow:bug-rca` | Investigate a ticket and document its root cause with evidence. |
| `/flow:bug-fix` | Implement and verify the fix an RCA specifies. |

### record — knowledge capture

| Command | Description | Absorbed |
| ------- | ----------- | -------- |
| `/flow:record-ddr` | Record an architectural or product decision (kgai graph when active). | ddr-keeper skill |

> **Bookend debate layer (DDR-130) adds no commands.** It rides inside `plan` (and `--prd`), `validate --security` and `bug-rca`. The seats (`builder`, `shipper`, `breaker`, `user-advocate`, `investigator`) are agents. The role agents `worker`, `spike` and `scout` (skill `flow:context-budget`) do the work inside `execute` and `run`.

## Refactor history (v1.10 — the old names were removed in the same release)

| Old | New |
| --- | --- |
| `/flow:setup-prd` | `/flow:plan --prd` |
| `/flow:quick` | `/flow:execute --quick` |
| `/flow:utils-verify` | `/flow:validate --fast` |
| `/flow:validate-security` · `-a11y` · `-visual` | `/flow:validate --security` · `--a11y` · `--visual` |
| `/flow:review-code` · `/flow:scenario` | `/flow:validate --review` · `--scenario` |
| `/flow:record-execution` · `/flow:record-retro` | `/flow:done` (report and retro steps) |
| `/flow:release-changelog` | `/flow:release --changelog` |
| `/flow:setup-context` · `/flow:setup-codebase-map` · `/flow:migrate-kgai` | `/flow:init --context` · `--map` · `--kgai` |
| `/flow:pause` · `/flow:resume` · `/flow:status` | `/flow:run --pause` · `--resume` · `--status` |
| `/flow:help` | Claude Code's native `/help` |
| `/flow:maintain-ai-health` · `-clean` · `-discover` · `-docs` | retired — `maude doctor`, or ask directly |

## Rename history (Phase 13)

Old name → new name. Backwards-compat stubs shipped under the old filenames in **v0.6.0** and were **removed in v0.6.1** (early removal — the stubs were under a day old in production and had no observed traffic). The old slash names no longer resolve.

| Old | New | Group | Reason |
| --- | --- | ----- | ------ |
| `/flow:verify` | `/flow:utils-verify` | utils | Verify is a sub-step of `/flow:execute`, not a top-level command. |
| `/flow:onboard` | `/flow:setup-onboard` | setup | One-shot bootstrapping (Phase 13 group prefix). |
| `/flow:setup-onboard` | `/flow:init` | setup | Renamed to match Claude Code's built-in `/init` verb; namespaced via `name: flow:init` frontmatter. |
| `/flow:create-prd` | `/flow:setup-prd` | setup | One-shot bootstrapping (PRD + phase plans). |
| `/flow:map-codebase` | `/flow:setup-codebase-map` | setup | Bootstrapping context for cross-session reuse. |
| `/flow:context` | `/flow:setup-context` | setup | Bootstrapping session-start priming. |
| `/flow:ddr` | `/flow:record-ddr` | record | Knowledge capture group. |
| `/flow:retro` | `/flow:record-retro` | record | Knowledge capture group. |
| `/flow:execution-report` | `/flow:record-execution` | record | Knowledge capture group. |
| `/flow:ai-health` | `/flow:maintain-ai-health` | maintain | Hygiene group. |
| `/flow:discover` | `/flow:maintain-discover` | maintain | Hygiene group (capability lookup is a maintenance task). |
| `/flow:code-review` | `/flow:review-code` | review | Single-member group; `review-*` reserves space for future siblings. |

### Footnote — "Record Design Decision Record" stutter

`/flow:record-ddr` doubles up "Record" because DDR is an established acronym ("Design Decision Record"). The Phase 13 convention (see [DDR-004](../../.ai/archive/decisions/DDR-004-flow-command-naming-prefix-convention.md)) is **strict consistency over recognized-acronym exception** — every non-daily command gets a group prefix, no exceptions. The stutter is the cost.
