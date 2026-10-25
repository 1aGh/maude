---
name: run
category: daily
type: command
description: "Run a plan unattended as a goal with a capped Stop gate; pause, resume, stop or report the run."
keywords: [run, goal, unattended, pause, resume, status]
argument-hint: "<plan path> [--done-cmd <cmd>] | --status | --pause [reason] | --resume | --stop"
---

# Run: a plan as a goal

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

`/flow:run` arms a plan so the session keeps working until the plan is done — every acceptance criterion ticked and the done check green — instead of stopping after each step. It reuses `/flow:execute` for the work and the `flow:context-budget` rules for spend. The state helper is the plugin's `hooks/run-hook.mjs`; call it as `node "<flow plugin root>/hooks/run-hook.mjs" <verb> …` from the project root (`<flow plugin root>` is the folder holding this command's `commands/`, i.e. `${CLAUDE_PLUGIN_ROOT}` in Claude Code).

**Safety.** Nothing blocks unless the repo opted in (`run.hooks: true`), this session armed the run, and the marker has not expired (`run.expiresHours`, default 24). The Stop gate lets the session end when `.ai/state/run-waiting.md` exists, after `run.maxStopBlocks` identical red checks (default 3 — it writes the waiting file itself), or past `run.budget.maxRunTokens`. Every block message names the kill switch: `/flow:run --pause`, `/flow:run --stop`, or `FLOW_RUN_HOOKS=0`.

## Arm — `/flow:run <plan path> [--done-cmd "<cmd>"]`

1. Read `run` from `.ai/workflows.config.json`. Hooks off → print how to turn them on (`maude config set run.hooks true`), say that without hooks the plan can still run as a goal with `/flow:execute` (nothing will hold the session open), and stop.
2. The plan must have an `## Acceptance Criteria` checklist — the gate counts its unticked boxes. No checklist → ask the user to add one or name the criteria; do not invent a passing gate.
3. Done check: `--done-cmd` if given; otherwise propose the project's `quality` gates joined with `&&` (`run.lane` wraps each suite) and confirm it with the user once.
4. Arm with this session's id (`${CLAUDE_SESSION_ID}`; if the host does not substitute it, the newest transcript name under `~/.claude/projects/<project slug>/`):
   `node "<flow plugin root>/hooks/run-hook.mjs" arm --plan <path> --session <id> [--done-cmd "<cmd>"]`
5. Print its output. The model cannot arm `/goal` itself, so end with the `GOAL:` line it printed and tell the user: **paste that `/goal …` line to start the run.** Then work through the plan with `/flow:execute`'s procedure, ticking each criterion when its evidence exists (commit, test, report).

## `--status`

`node "<flow plugin root>/hooks/run-hook.mjs" status`, then add `maude flow usage` (spend so far; Claude Code only) and the next unchecked task of the plan. Replaces `/flow:status` for a run.

## `--pause [reason]`

Checkpoint first: tick finished tasks and criteria in the plan, append a progress note (what is done with commit SHAs, what is next, open questions). Then `… run-hook.mjs pause --reason "<reason>"`. Tell the user the gate is open — `/compact` or closing the session is safe now (a `/compact` typed while the gate holds the turn only runs after a pause). Replaces `/flow:pause` during a run.

## `--resume`

In the new or compacted session: read the plan's progress note and `git log`, then `… run-hook.mjs resume --session <this session's id>` and print the `/goal` line again (`status` shows the plan and done check). Replaces `/flow:resume` during a run.

## `--stop`

`… run-hook.mjs disarm` — removes the marker; every hook is a no-op again. Use it when the run is finished or abandoned. Tell the user to clear the goal too (`/goal` with no condition).

## Codex and hooks-off hosts

No hooks run: arm still writes the marker so `--status`/`--pause`/`--resume` work as plain state commands, the brief rules come from `flow:context-budget`, and the session continues only as long as the user keeps it going.
