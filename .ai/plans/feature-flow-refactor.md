# Feature: Flow plugin refactor — lean command set, economical runs, plans that run as goals

Validate docs and codebase patterns before implementing. Pay attention to existing naming (DDR-004 group prefix, DDR-191 bare `name:`), the generated Codex mirrors and the project-agnostic `<project>` convention.

## Description

Rebuild the `flow` plugin from a clean slate in four releasable phases:

1. **Economy by default.** Bring the token and context lessons of the 16-day Maude v2 `/goal` run into the plugin, out of the box and project-agnostic:
   - role agents with a model and an effort,
   - briefs that carry only the plan slice,
   - capped agent sessions that hand back `## Decisions` + `## Continue`,
   - a lead checkpoint at phase boundaries,
   - gates per logical batch, focused tests in workers,
   - a per-agent spend report.
2. **A smaller surface.** 31 commands → 10. Everything else merges into a kept command, or becomes a one-release stub and is then deleted.
3. **Plans run as goals.** A new `/flow:run` arms a plan as a gated, unattended run. It reuses the v2 harness: a marker file, opt-in hooks, a done check, and a waiting-for-human valve. It has hard caps so a downstream user can never be trapped.

## User Story

As a developer using flow in any repo, I want plan → execute → validate → done to run economically and, when I choose, unattended to completion, so that features ship without me re-prompting every step or paying for oversized agent contexts.

## Problem

- **Cost.** The v2 run measured that spend is driven by context size, not by the model. Sub-agents were ~80–91 % of spend, and agents reached 600–830k context by reading whole plans and 330 kB files. None of the fixes live in the plugin. No flow agent declares `model:`/`effort:`, and `/flow:execute` briefs carry no budget.
- **Surface.** The plugin has 31 commands (5,257 lines), 21 hand-written skills and 31 generated Codex mirrors. Many commands were written when models needed hand-holding. Transcript census, 2026-10-25, all local Claude projects:

  | Command | Uses |
  | --- | --- |
  | done | 42 |
  | plan | 30 |
  | execute | 20 |
  | release | 15 |
  | bug-fix | 12 |
  | validate | 11 |
  | bug-rca | 9 |
  | setup-prd | 6 |
  | init | 5 |
  | quick | 4 |
  | every other command | 0–2 |

  Cross-references are high even for rarely used commands: `init` 42, `scenario` 38, `utils-verify` 27, `record-ddr` 27, `pause` 24, `status` 23, `resume` 22.
- **Unattended runs.** The archived `/goal` plan (`archive/feature-goal-unattended-pipelines.md`, rejected 2026-09-22) only taught users goal wording. The v2 run proved a working mechanism instead: a marker-gated Stop hook plus a done script and a waiting file. It still lives only as Maude-specific scripts (`scripts/v2-hooks/`).

## Solution (decided — divergent debate, reduce tier, 2026-10-25; Michal chose "staged clean slate")

**Seats.** BUILDER: collapse to ~9 verbs, ship the v2 hooks generically. SHIPPER: lift what exists, stubs not deletes, phase so the plugin works between releases. BREAKER: strand 1 holds ~all savings and strands 2–3 hold ~all breakage, so guard them.

**Synthesis — target set:**

| Command | Absorbs |
| --- | --- |
| plan | setup-prd → `plan --prd`; keeps the debate |
| execute | quick → `execute --quick` (one task, no plan) |
| validate | utils-verify → `--fast`; validate-security / validate-a11y / validate-visual / review-code / scenario → lanes switched on by flag or config; security stays a debate bookend |
| done | record-execution, record-retro |
| bug-rca | — |
| bug-fix | — |
| release | release-changelog → a release step |
| record-ddr | ddr-keeper |
| init | setup-context, setup-codebase-map, migrate-kgai as idempotent steps |
| run (new) | pause / resume / status → `run --pause \| --resume \| --status` |

Retired with a stub: `help` (native `/help` lists plugin commands), `maintain-ai-health`, `maintain-clean`, `maintain-discover`, `maintain-docs`.

**Breaker's five guardrails are acceptance criteria, not suggestions:**
1. Deprecate before deleting. One-release stubs, plus a ratchet test that every `flow:<name>` reference resolves.
2. Blocking hooks are opt-in and capped, with a kill switch named in every block message.
3. Budget ceiling and stall detection on a run.
4. Model routing by tier in config, never literal model ids.
5. Hooks and test harnesses never touch the real HOME or prefs, and never spawn the real `claude`.

**Timing.** `feat/maude-v2` also edits plugin surfaces (S12, gen-plugin-surfaces, v2-words). Start P1 on a branch cut from `main` **after the v2 PR merges**. If started earlier, cut it from the `feat/maude-v2` tip in a worktree and rebase.

## Metadata

- **Type**: Refactor + New Capability
- **Complexity**: High
- **App/Package**: `plugins/flow` (primary), `plugins/design` (agent frontmatter, references), `cli/` (usage verb, init, tests), `plugins/flow/templates/ai-skeleton/`, `site/content/docs`
- **Affected Systems**: flow commands/skills/agents/hooks, config schema, Codex mirrors (`scripts/gen-plugin-surfaces.mjs`), `maude init`/`doctor`/`help`, docs site
- **Dependencies**:
  - A Claude Code version that supports plugin hook events SubagentStart, SubagentStop and Stop, plus native `/goal`. Pin the minimum version in `plugins/flow/dependencies.json` after the T0 spike.
  - None on Codex. It degrades to prose rules.

---

## Context References

### Must-Read Files

> During `/flow:execute`, read every file listed here in parallel in one message. They are independent loads; read the large ones by range.

**v2 economy and harness (the source to generalise):**
- `.ai/scenarios/maude-v2/agent-routing.md` — routing table, risk classes, context budget rules 1–4.
- `.claude/agents/v2-builder.md`, `v2-spike.md`, `v2-scout.md` — role agents with `model:`/`effort:`; lift them and strip the v2 specifics.
- `scripts/v2-hooks/v2-hook.mjs` and `v2-hook.test.mjs` (285 lines) — marker gate, block JSON, SubagentStart rule injection, SubagentStop `## Decisions`, Stop gate with the waiting valve. Port these with their tests.
- `scripts/v2-hooks/v2-usage.mjs` — per-agent spend from transcripts; becomes the usage verb.
- `scripts/v2-test-lane.sh` — the lock + dist-revert lane; becomes the pattern behind the `quality.lane` config.

**Plugin structure and conventions:**
- `plugins/flow/hooks/hooks.json` — today only SessionStart (preflight + kg sync, warn-only).
- `plugins/flow/.claude-plugin/config.schema.json` — `orchestration` has bookends, designTeam, escalationCeiling, maxSeats, mode. The new keys go here.
- `plugins/flow/HARNESS.md` — Codex translation. Hooks may be unavailable there, and roles become native subagents with the role file.
- `plugins/flow/commands/{plan,execute,validate,done,bug-rca,bug-fix,release,init,pause,resume,status}.md` — the kept and merged bodies.
- `plugins/flow/skills/debate-protocol/SKILL.md` and DDR-130 — the seats stay. The debate agent `builder.md` already exists, so the new worker must use a different name.
- `scripts/gen-plugin-surfaces.mjs` — Codex mirrors and the slash list, plus the `--check` gate.

**Tests that guard the surface:**
- `cli/lib/plugin-name-namespace.test.mjs`, `plugin-surfaces.test.mjs`, `flow-design-integration.test.mjs`, `plugin-cli-reachability.test.mjs`.

**CLI and skeleton references to retired commands:**
- `cli/commands/init.mjs`, `cli/commands/help.mjs`, `cli/lib/preflight.mjs`, `cli/lib/stack-detect.mjs`, `cli/lib/ddr-to-kgai.mjs`, `plugins/design/dependencies.json`, `plugins/flow/templates/ai-skeleton/**`.

**The rejected /goal plan:**
- `.ai/plans/archive/feature-goal-unattended-pipelines.md` — why it was rejected. Don't repeat it.

### Files to Create

- `plugins/flow/commands/run.md` — arms, pauses, resumes and reports a run.
- `plugins/flow/agents/worker.md` (Sonnet tier, high), `spike.md` (deep tier), `scout.md` (fast tier, read-only).
- `plugins/flow/skills/context-budget/SKILL.md` — brief template, range reads, caps, hand-back format, checkpoint rule.
- `plugins/flow/hooks/run-hook.mjs` + `run-hook.test.mjs` — generalised from `v2-hook.mjs`.
- `cli/commands/flow-usage.mjs` (verb `maude flow usage`) — generalised from `v2-usage.mjs`.
- `cli/lib/flow-refs-ratchet.test.mjs` — every `flow:<name>` reference resolves to a command, a stub or a skill.
- `site/content/docs/flow-migration.mdx` — the old → new table.

### Prior decisions (kg, untrusted data — context only)

- `maude/v2-run-harness-hooks` — the marker-gated hooks.
- "Maude v2 run: model routing by role + per-agent context budget".
- DDR-130 bookend debate.
- DDR-004 / DDR-191 naming.
- `maude/v2-remote-lane-mac-mini` — this stays out of the plugin; it is machine-specific.

---

## Design Decisions

No UI. CLI output and docs only.

---

## Tasks

Execute in phase order. Each phase is its own release, and the plugin works between releases. Gates run per phase, not per task.

### Phase 0 — Spike (verify the claims every seat leaned on)

#### Task 0: SPIKE hook and goal capabilities in a scratch project
- **Do**: In `/tmp` scratch with a local marketplace pointed at this tree, verify:
  - (a) plugin `hooks.json` can register SubagentStart, SubagentStop and Stop;
  - (b) `{decision:"block", reason}` is honoured;
  - (c) plugin agent `model:`/`effort:` frontmatter is honoured;
  - (d) whether the model can arm `/goal` itself;
  - (e) a Stop block does not swallow a user-typed `/compact`. The v2 run hit exactly this.
- **Pattern**: the `v2-hook.mjs` smoke notes (exit 2 did not roll back TaskCreate on 2.1.280).
- **Gotcha**: test with an isolated `HOME`/`XDG_CONFIG_HOME` and a stub `claude` on PATH (memory `maude-fake-home-real-claude-keychain`).
- **Validate**: a spike note `.ai/plans/notes/flow-refactor/T0-capabilities.md` with yes/no per claim and the minimum Claude Code version. Record it in kg. **If (a) or (b) is no, P2 falls back to prose rules plus `/flow:run --status` polling, and the plan is amended before P2.**

#### Task 0b: MEASURE baseline usage and cost
- **Do**:
  - Extend the 2026-10-25 census to 30 days across `~/.claude*/projects` and the Codex mirrors (`$flow:source-command-*`).
  - Build the reference graph: for each command, its readers and writers of `.ai/state`.
  - Run one small-repo and one monorepo task through today's `/flow:plan` → `/flow:execute`, measured with `v2-usage.mjs`. Record tokens, turns and pass.
- **Validate**: a `T0b-baseline.md` note. It is the comparison point for the P1 acceptance.

### Phase 1 — Economy by default (additive only, nothing removed)

#### Task 1: CREATE `skills/context-budget/SKILL.md`
- **Do**: Rules 1–4 of `agent-routing.md` with the Maude specifics removed:
  - the brief carries the plan slice, owned files and a kg digest;
  - files over `run.largeFileKB` are read by range;
  - caps `run.budget.agentTurns` and `agentContextK`;
  - hand-back ≤ `handbackLines` ending in `## Decisions` and an optional `## Continue`;
  - the lead checkpoints at a phase boundary or ≥ `leadCheckpointPct`.
  
  Express everything as ratios and presets (`small` / `default` / `monorepo`), not v2 constants (breaker).
- **Validate**: `node scripts/gen-plugin-surfaces.mjs --check`.

#### Task 2: CREATE role agents `worker`, `spike`, `scout`
- **Do**: Lift them from `.claude/agents/v2-*.md`, drop the v2 ids, and point each one at `context-budget`. Frontmatter uses tier aliases (`model: sonnet` / `opus` / `haiku`), never dated ids. `scout` gets the tools Read, Grep, Glob and Bash.
- **Gotcha**: the name collides with the debate seat `agents/builder.md`, hence `worker`. The `subagent_type` must be `flow:worker` (DDR-191).
- **Validate**: `node --test cli/lib/plugin-name-namespace.test.mjs`.

#### Task 3: ADD config keys `run.*` to `config.schema.json`
- **Do**: Add these keys:

  | Key | Contents |
  | --- | --- |
  | `run.routing` | `{worker, spike, scout, critic}` → `{tier: fast\|deep, effort}` |
  | `run.riskClasses` | globs/tags that send a worker to the deep tier |
  | `run.budget` | `{preset, agentTurns, agentContextK, handbackLines, leadCheckpointPct}` |
  | `run.largeFileKB` | size above which files are read by range |
  | `run.gates` | `per-batch` (default) or `per-task` |
  | `quality.lane` | an optional wrapper command that serialises suites |

  Every key is optional and absent = today's behaviour.
- **Validate**: `node --test cli/lib/config-lint*.test.mjs`. `maude doctor` stays clean on this repo's config.

#### Task 4: UPDATE `execute.md` and `plan.md` to use roles and budgets
- **Do**:
  - `execute` spawns `flow:worker`, escalated to `flow:spike` by `riskClasses`. It passes the brief template from `context-budget` and runs focused tests in the worker. Full gates run at `run.gates` boundaries.
  - `plan` writes per-task "slice" anchors so a brief can quote one task.
  - Both honour `quality.lane`.
- **Validate**: dry-run one plan in a scratch repo. The brief must show the slice only, never the whole plan.

#### Task 5: UPDATE design and flow critic agents with tier frontmatter
- **Do**:
  - `design:*-critic`, `flow:a11y-auditor`, `flow:scenario-runner` and `flow:design-system-guard` → `model: sonnet`.
  - The security pair inherits (deep).
  - The debate seats are unchanged (re-running the n=8 eval is out of scope unless they are touched).
- **Validate**: `node --test cli/lib/flow-design-integration.test.mjs`.

#### Task 6: CREATE `maude flow usage`
- **Do**: Generalise `v2-usage.mjs`. It takes a session id or the run marker and prints the lead plus each agent's model, turns, peak context and read/write. It flags agents whose peak was over the budget. `done` prints the summary when a run marker exists.
- **Gotcha**: this works on Claude transcripts only. On Codex it prints "unavailable" and never fails a gate.
- **Validate**: run it against a Maude v2 transcript. The output must match `v2-usage.mjs`.

**P1 gate:**
- Lint, the CLI tests, and `gen-plugin-surfaces --check`.
- A/B against the T0b baseline on both repo sizes: monorepo tokens ↓ with an equal pass rate, and the small repo not worse.
- Release P1.

### Phase 2 — `/flow:run`: a plan as a goal (opt-in, capped)

#### Task 7: CREATE `hooks/run-hook.mjs` + tests (port `v2-hook.mjs`)
- **Do**: Hook events SubagentStart (inject the context-budget rules), SubagentStop (require `## Decisions`; one retry, then allow with a warning) and Stop. Drop the TaskCreated/TaskCompleted ledger gates (v2-specific).
- **Every hook is a no-op unless all of these hold:**
  - (i) `run.hooks: true` in config,
  - (ii) `.ai/state/run.json` exists,
  - (iii) its `sessionId` matches,
  - (iv) it has not expired,
  - (v) `FLOW_RUN_HOOKS` is not `0`.
- **The Stop gate:**
  - It blocks while the run's `doneCmd` is red: the plan's unchecked tasks + Progress-log SHAs, then the configured `quality` gates.
  - It allows the stop when `.ai/state/run-waiting.md` exists.
  - After `run.maxStopBlocks` (default 3) identical reds it writes the waiting file itself and allows the stop.
  - It allows the stop when `run.expires` or `run.budget.maxRunTokens` is reached, after writing a checkpoint.
  - Every block message names the kill switch.
- **Gotcha**: hooks must not run tests or `claude` against the real HOME. Every test uses an isolated HOME and a stub `claude`, and asserts that the mtime of a real prefs file is unchanged (guardrail 5).
- **Validate**: `node --test plugins/flow/hooks/run-hook.test.mjs`. Every planted case is red with a no-op hook (memory `maude-verify-regression-tests-fail-first`).

#### Task 8: REGISTER the hooks in `hooks/hooks.json`
- **Do**: Add the three events next to the existing SessionStart. Use the same `CLAUDE_PLUGIN_ROOT`/`maude` resolution as preflight. Timeouts ≤ 10 s.
- **Validate**: in the T0 scratch project, a session without a marker stops normally and no hook output appears.

#### Task 9: CREATE `commands/run.md`
- **Do**:
  - **`/flow:run <plan>`** checks that `run.hooks` is on (otherwise it explains how to turn it on). It writes `run.json` with `{sessionId, plan, doneCmd, expires, maxStopBlocks}`, prints the budget preset, then prints the one `/goal <condition>` line built from the plan's acceptance criteria. If T0 found the model can arm `/goal` itself, it arms the goal instead.
  - **`--status`** reads the Progress log, task state, usage and the waiting file. It replaces `status`.
  - **`--pause`** writes a checkpoint (Progress log + task snapshot + exact next steps) and creates the waiting file. It replaces `pause`.
  - **`--resume`** reads the checkpoint, rewrites the marker `sessionId` and removes the waiting file. It replaces `resume`.
  - **`--stop`** removes the marker.
- **Gotcha**: `/compact` during a goal works only after a pause (v2 lesson). `run --pause` tells the user so.
- **Validate**: dogfood one real small plan in this repo end to end. The run must stop on green, pause on the waiting file and allow the stop after 3 identical reds.

#### Task 10: UPDATE `HARNESS.md` for Codex
- **Do**: Codex runs `run` without hooks. Rules arrive as prose in briefs, and `--status`/`--pause`/`--resume` work as plain state commands.
- **Validate**: `gen-plugin-surfaces --check`.

**P2 gate:**
- Hook tests.
- Dogfood evidence in `.ai/plans/notes/flow-refactor/P2-dogfood.md`.
- Release P2 with `run.hooks` defaulting to false.

### Phase 3 — Merges and stubs

#### Task 11: MERGE commands into the kept set
- **Do**: Fold each merged command's still-relevant steps into its target command as flags or lanes, per the Solution table. Cut the narration that models no longer need.
  - **Size targets:** `init` ≤ 250 lines, `plan` ≤ 300, every other kept command ≤ 200.
  - **Keep behaviour:** `validate --security` must still trigger the DDR-130 adversarial bookend.
- **Validate**: `plugin-surfaces`, `flow-design-integration` and `plugin-cli-reachability` tests.

#### Task 12: REPLACE retired commands with stubs
- **Do**: Each retired file keeps its name and `name:`, and becomes ≤ 8 lines: "Retired in vX.Y — use `/flow:<new> <flag>`" (or the native equivalent), then it performs the replacement. Regenerate the Codex mirrors.
- **Validate**: `gen-plugin-surfaces --check`.

#### Task 13: MERGE and DELETE skills
- **Merge**:
  - `a11y-rules` + `a11y-checker` + `responsive-rules` + `motion-rules` → `ui-rules`, with the old names kept as one-release stubs;
  - `ddr-keeper` → `record-ddr`;
  - `claude-md-keeper` → `done`;
  - `kgai-migrate` → `init`.
- **Delete after a stub release**:
  - `skill-loader` (native skill discovery),
  - `make-skill-template`,
  - `codebase-intelligence` (`init` keeps a short map step).
- **Keep**:
  - orbit-backend, kgai-backend, quality-gates, debate-protocol, question-protocol, security-rules, debugging-rules, testing-rules, workflow-state, context-budget;
  - agent-browser, agent-device and scenario (tool manuals, loaded only on use). A move to a companion plugin is deferred and needs its own decision.
- **Validate**: the census from T0b shows no non-stub use of a deleted skill.

#### Task 14: UPDATE every reference and add the ratchet
- **Do**: Update the CLI (`init`/`help`/`preflight`/`stack-detect`/`ddr-to-kgai`), `plugins/design` (including `dependencies.json`), `ai-skeleton/**`, `apps/studio/actions` and `site/content`. Then create `flow-refs-ratchet.test.mjs`.
- **Validate**: the ratchet is green, and a planted dangling reference makes it red.

#### Task 15: DOCS and DECISIONS
- **Do**:
  - `site/content/docs/flow-migration.mdx` with the old → new table.
  - The README command list.
  - CLAUDE.md flow notes.
  - One graph decision via `/flow:record-ddr` (kg): `maude/flow-refactor-lean-surface` and `maude/flow-run-goal-harness`. They reference DDR-130 and the v2 harness decision.
- **Validate**: the `site-content` gate.

**P3 gate:**
- All `cli/lib` and `scripts/test` suites, plus `gen-plugin-surfaces --check`.
- `maude doctor` clean on this repo and on a fresh `maude init` scratch repo.
- Release P3.

### Phase 4 — Delete the stubs (one minor release later)

#### Task 16: REMOVE the stubs and their mirrors
- **Do**: Only after the T0b-style census over the stub release shows no use, or Michal says go. Delete the stub files and regenerate.
- **Validate**: the ratchet is green and the surfaces check is green. Release P4.

---

## Validation

1. **Lint**: `pnpm lint`
2. **Plugin and CLI tests**: `node --test cli/lib/*.test.mjs scripts/test/*.test.mjs`
3. **Hook tests**: `node --test plugins/flow/hooks/run-hook.test.mjs` (isolated HOME, stub `claude`)
4. **Surfaces**: `node scripts/gen-plugin-surfaces.mjs --check`
5. **Config**: `maude doctor` on this repo and on a fresh `maude init` scratch repo
6. **Cost A/B** (P1): `maude flow usage` versus the T0b baseline on a small repo and a monorepo
7. **Dogfood** (P2): one real plan via `/flow:run` with stop-on-green, the pause valve and the 3-red cap
8. **Manual**: a Codex session runs `/flow:plan` → `execute` → `validate` → `done` with the mirrors, and does not trip over missing hooks

No UI, so no scenario-runner, design-system-guard or a11y-auditor.

---

## Acceptance Criteria

- [ ] T0 capability note recorded; plan amended if hooks or block JSON are unsupported
- [ ] P1: monorepo task tokens drop versus baseline with an equal pass rate; small repo is not worse; nothing removed
- [ ] P2: `/flow:run` stops only on green, honours the waiting file, auto-pauses after `maxStopBlocks`, honours `expires`/`maxRunTokens`, names the kill switch in every block, and is a no-op when `run.hooks` is off
- [ ] P3: 10 commands plus stubs; every reference resolves (ratchet); the Codex mirrors are regenerated; the migration doc is published
- [ ] P4: stubs deleted only after measured non-use or Michal's go
- [ ] Guardrails 1–5 each have a test or a check that fails without them
- [ ] No hook or harness touched the real HOME/prefs or spawned the real `claude`
- [ ] Decisions recorded in kg; `site/lib/roadmap.json` regenerated in the commit that adds this plan

## Key risks

| Risk | Mitigation |
| --- | --- |
| A Stop hook traps a downstream user in a paid loop | opt-in config + marker + session match + expiry + 3-red cap + kill switch (T7) |
| Hidden users (marketplace, Codex, StudyFi repos) lose commands | stub release + census before P4 (T0b, T12, T16) |
| v2 constants are wrong for small repos | presets and ratios, A/B on both sizes (T1, P1 gate) |
| Model ids drift | tier aliases plus config routing (T2, T3) |
| Conflicts with `feat/maude-v2` plugin edits | start after the v2 merge, or rebase a worktree off its tip |
