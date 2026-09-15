# flow — agentic workflow plugin

Generic agentic workflow loop with a second-brain `.ai/` workspace. Project-agnostic via `<project>` placeholders + per-repo `.ai/workflows.config.json`.

> For installation and the marketplace-level overview, see the [root README](../../README.md). For the canonical command catalog, see [`CATEGORIES.md`](./CATEGORIES.md).

## Commands at a glance

29 slash commands across 9 categories. Type **`/flow:help`** inside Claude Code for the live, auto-generated grouped index — it parses every command's `category:` frontmatter and prints the table fresh each time.

| Group | Count | What it does |
| ----- | ----- | ------------ |
| **daily** | 11 | Every-cycle workflow: `plan`, `execute`, `done`, `validate`, `release`, `status`, `pause`, `resume`, `scenario`, `quick`, `help`. |
| **setup-*** | 4 | One-shot bootstrapping: `init`, `setup-prd`, `setup-codebase-map`, `setup-context`. |
| **validate-*** | 2 | Specialized validators: `validate-a11y`, `validate-visual`. |
| **bug-*** | 2 | Incident workflow: `bug-rca`, `bug-fix`. |
| **record-*** | 3 | Knowledge capture: `record-ddr`, `record-retro`, `record-execution`. |
| **maintain-*** | 4 | Hygiene: `maintain-clean`, `maintain-docs`, `maintain-ai-health`, `maintain-discover`. |
| **review-*** | 1 | `review-code` (pre-commit self-review). |
| **release-*** | 1 | `release-changelog` (sibling of daily `release`). |
| **utils-*** | 1 | `utils-verify` (sub-step of `execute`). |

## Naming convention

| Type | Pattern | Examples |
| ---- | ------- | -------- |
| **Daily** (called every feature cycle) | terse verb, no prefix | `plan`, `execute`, `done`, `validate`, `release` |
| **Everything else** | `<group>-<verb>` | `bug-fix`, `setup-prd`, `record-ddr`, `maintain-clean` |

The prefix is **load-bearing**: Claude Code does not support subdirectory namespacing for slash commands ([issue #2422](https://github.com/anthropics/claude-code/issues/2422)), so the `<group>-` prefix is what makes `/flow:bug-` autocomplete to only the bug-* commands. Every non-daily command carries a `category:` frontmatter field that matches its prefix — `/flow:help` reads those fields to render the grouped index.

For the full catalog (group definitions, member descriptions, rename history), see [`CATEGORIES.md`](./CATEGORIES.md).

## Subagents

- `scenario-runner` — orchestrates cross-platform scenarios.
- `a11y-auditor` — WCAG 2.1 AA pass over changed UI.
- `design-system-guard` — compares rendered UI to the project's design system doc.
- `test-coverage` — flags untested logic paths.

## Skills

`workflow-state`, `ddr-keeper`, `scenario`, `agent-browser`, `agent-device`, `codebase-intelligence`, `a11y-checker`, `question-protocol`, `make-skill-template`, `claude-md-keeper`, `debugging-rules`, `a11y-rules`, `motion-rules`, `responsive-rules`, `testing-rules`, `skill-loader`, `orbit-backend` (the `orbit` tracker provider's contract).

See [`skills/`](./skills/) for the full list and per-skill SKILL.md files.
