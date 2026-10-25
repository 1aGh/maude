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
2. Non-daily filenames **must** start with the group name + dash (the bare verb `init` is the lone exception). The `name:` frontmatter field is the **bare** slug — `<filename-sans-md>` (e.g. `bug-fix`, `setup-prd`), with no `flow:` prefix. Claude Code namespaces it to `flow:bug-fix` / `flow:setup-prd` itself at registration (per [DDR-191](../../.ai/archive/decisions/DDR-191-revert-plugin-name-prefix-claude-code-now-namespaces.md) — superseding the older [DDR-006](../../.ai/archive/decisions/DDR-006-plugin-namespace-in-name-frontmatter.md), which had us prefix it by hand as a workaround for a since-fixed Claude Code bug; doing that today stutters the namespace twice in autocomplete).
3. Slash-command namespacing via subdirectories is **not supported by Claude Code** ([issue #2422](https://github.com/anthropics/claude-code/issues/2422), [open feature request #44678](https://github.com/anthropics/claude-code/issues/44678)). Claude Code's own `flow:` namespacing (added at registration, not written in `name:`) is the working substitute — typing `/flow:bug-` then narrows autocomplete to `bug-rca` + `bug-fix`.
4. Run `/flow:help` for the live, auto-generated grouped index.

## Groups

### daily — every-cycle workflow

Verb-as-complete-action. Terse names. Includes `validate` and `release` which also act as parent commands of specialized groups (`validate-*`, `release-*`).

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:plan` | Context-rich feature plan grounded in PRD + design system. | Starting a feature. |
| `/flow:execute` | Execute an implementation plan. | After `/flow:plan` lands. |
| `/flow:done` | Close out a feature — validate → commit → push → PR → retro → archive. | All tasks pass `/flow:utils-verify`. |
| `/flow:validate` | Full validation pipeline (static + tests + build + scenario + a11y + design). | Before `/flow:done` or on demand. |
| `/flow:status` | Unified situational awareness — where you are, what's next. | Resuming a session. |
| `/flow:pause` | Snapshot state, write HANDOFF.md, ready for context switch. | Stepping away mid-task. |
| `/flow:resume` | Resume a previously paused workflow. | Coming back from a pause. |
| `/flow:scenario` | Cross-platform UI scenario across 5 platforms. | Manual smoke / validation. |
| `/flow:quick` | Fast-path for trivial changes — skip plan cycle. | One-line hotfix, doc nudge. |
| `/flow:release` | Walk the project's release runbook with explicit confirmation per step. | Cutting a release. |
| `/flow:run` | Run a plan unattended as a goal: opt-in Stop gate with caps, plus `--status` / `--pause` / `--resume` / `--stop`. | Handing a whole plan to the session. |
| `/flow:help` | Auto-generated grouped index (this catalog, live from frontmatter). | When you forget a command name. |

> **Bookend debate layer (DDR-130) adds no new commands.** The opt-in multi-agent debate rides *inside* existing commands at the loop's bookends (`plan`/`setup-prd`/`validate-security`/`bug-rca`, design `setup-ds`/`critic`), gated by `orchestration.*` in `.ai/workflows.config.json`. The seats (`builder`, `shipper`, `breaker`, `user-advocate`, `investigator`) are agents, not commands — not catalogued here. See `plugins/flow/skills/debate-protocol/SKILL.md`.

### utils — sub-commands

Internal verbs called from inside other commands. Not primary user actions, but exposed as slash commands so they can be invoked standalone when debugging.

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:utils-verify` | Light per-file check during `/flow:execute`'s Edit-Verify Loop. | Inside `/flow:execute`. |

### setup — one-shot bootstrapping

Operations that run once per project (or once per major restructure).

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:init` | Scaffold `.ai/`, auto-detect stack, populate `workflows.config.json`, defer to `/init` for CLAUDE.md. | First-time setup in a repo. |
| `/flow:setup-prd` | Draft a PRD + auto-generated phase plans + execution README. | Starting a multi-phase initiative. |
| `/flow:setup-codebase-map` | Snapshot the architecture into `.ai/context/` for cross-session reuse. | After a big refactor, or when context drifts. |
| `/flow:setup-context` | Prime the agent with the codebase map + CLAUDE.md. | Beginning of a session. |

### validate — specialized validators

Called by the `/flow:validate` parent or directly when you want only one check.

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:validate-a11y` | Accessibility audit (WCAG 2.1 AA). | Touching UI or forms. |
| `/flow:validate-visual` | Visual regression check with screenshots. | Touching layout/tokens. |
| `/flow:validate-security` | OWASP-class + adversarial review of the diff. Spawns `security-auditor` + `ethical-hacker`. | Touching auth, payments, untrusted input, dependencies, or MCP/model surface. |

### bug — incident workflow

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:bug-rca` | Analyze and document root cause for a ticket (provider per `integrations.tracker`). | Opening a bug. |
| `/flow:bug-fix` | Implement the fix from the RCA document. | After RCA. |

### record — knowledge capture

Append-only artifacts that future sessions read.

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:record-ddr` | Record a Design Decision Record. (DDR is an established acronym — accepted "Record Design Decision Record" stutter; see footnote.) | Non-trivial architecture or library choice. |
| `/flow:record-retro` | Implementation-vs-plan retrospective. | After `/flow:done`. |
| `/flow:record-execution` | Generate an implementation report for system review. | Ad-hoc reflection. |

### maintain — hygiene

Cleanup, freshness, infrastructure health.

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:maintain-clean` | Clean stale artifacts, logs, temp files. | Periodic housekeeping. |
| `/flow:maintain-docs` | Documentation freshness check — scan for stale references. | After big renames. |
| `/flow:maintain-ai-health` | Diagnose health of the AI infrastructure (commands, skills, agents, state). | Suspected `.ai/` drift. |
| `/flow:maintain-discover` | Search AI capabilities by natural-language task description. | "What command should I use for X?" |

### review — pre-commit / pre-PR

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:review-code` | Pre-commit self-review of uncommitted changes. | Before `/flow:done`. |

### release — release-time

Sibling of daily `/flow:release` (the runbook walker).

| Command | Description | Typical trigger |
| ------- | ----------- | --------------- |
| `/flow:release-changelog` | Author a changelog entry using the configured provider (changesets, git-cliff, …). | During a release. |

---

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
