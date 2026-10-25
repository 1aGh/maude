# flow — agentic workflow plugin

Generic agentic workflow loop with a second-brain `.ai/` workspace. Project-agnostic via `<project>` placeholders + per-repo `.ai/workflows.config.json`.

> For installation and the marketplace-level overview, see the [root README](../../README.md). For the canonical command catalog, see [`CATEGORIES.md`](./CATEGORIES.md).

## Commands at a glance

10 slash commands. Type **`/help`** inside Claude Code for the live list. Variants are flags (`/flow:plan --prd`, `/flow:execute --quick`, `/flow:validate --security`), not separate commands. Coming from the older surface? See [Flow migration](https://maude.sh/docs/flow-migration).

| Command | What it does |
| ------- | ------------ |
| `plan` | Feature plan; `--prd` drafts a PRD with phase plans. |
| `execute` | Run a plan task by task; `--quick` for trivial changes. |
| `validate` | Quality pipeline; `--fast`, `--security`, `--a11y`, `--visual`, `--review`, `--scenario` run one lane. |
| `done` | Validate, commit, PR, execution report, retro, archive. |
| `bug-rca`, `bug-fix` | Incident workflow. |
| `release` | Walk the release runbook; `--changelog` authors the entry. |
| `record-ddr` | Record a Design Decision Record. |
| `init` | Scaffold `.ai/`; `--context`, `--map`, `--kgai`. |
| `run` | Drive a plan as a goal (opt-in capped Stop hook); `--pause`, `--resume`, `--status`, `--stop`. |

## Naming convention

| Type | Pattern | Examples |
| ---- | ------- | -------- |
| **Daily** (called every feature cycle) | terse verb, no prefix | `plan`, `execute`, `done`, `validate`, `release`, `run` |
| **Everything else** | `<group>-<verb>` | `bug-fix`, `bug-rca`, `record-ddr` |

The prefix is **load-bearing**: Claude Code does not support subdirectory namespacing for slash commands ([issue #2422](https://github.com/anthropics/claude-code/issues/2422)), so the `<group>-` prefix is what makes `/flow:bug-` autocomplete to only the bug-* commands. Every non-daily command carries a `category:` frontmatter field that matches its prefix — the catalog is built from those fields.

For the full catalog (group definitions, member descriptions, rename history), see [`CATEGORIES.md`](./CATEGORIES.md).

## Subagents

- `worker` / `spike` / `scout` — role agents `/flow:execute` and `/flow:run` delegate to (implement a slice / answer one question / read-only inventory).
- `scenario-runner` — orchestrates cross-platform scenarios.
- `a11y-auditor` — WCAG 2.1 AA pass over changed UI.
- `design-system-guard` — compares rendered UI to the project's design system doc.
- `test-coverage` — flags untested logic paths.

## Skills

`workflow-state`, `context-budget`, `scenario`, `agent-browser`, `agent-device`, `question-protocol`, `debugging-rules`, `ui-rules`, `testing-rules`, `orbit-backend` (the `orbit` tracker provider's contract).

See [`skills/`](./skills/) for the full list and per-skill SKILL.md files.
