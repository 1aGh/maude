# Agent eval (V2-1.18) — topology A vs B on fixture canvases

A headless eval of how Claude edits a Maude project, through the real `design` plugin of this
worktree (`claude -p --plugin-dir plugins/design`). It decided the v2 agent topology in Phase 1
(V2-1.18, contract note `apps/studio/client/v2/contracts/V2-1.18-agent-topology.md`) and is the
regression slice V2-8.16 re-runs on the final build. **Not a CI gate**: it costs real model usage
and minutes per trial.

- **Topology A** — one writer (the main agent) + skills.
- **Topology B** — A + three prototype helpers (`topologies/b/plugin/agents/`): `board-reader`
  (read-only), `artboard-drafter` (parallel fan-out writing draft fragments), `ds-switcher`
  (parallel fan-out writing proposals). They are prototypes for the eval only; nothing ships them.
- Both get the same v2 rules (`topologies/contract.md`, appended to the system prompt like the
  ACP studio brief) and the same **prototype edit-safety harness** (`harness/`): deny-only,
  fail-open hooks around the file tools (V2-1.11 §5.4) with `maude design check` in PostToolUse
  and a rollback on a failed check, plus stand-ins for the v2 verbs that don't exist yet
  (`check`, `trash`, `runs`).

## Run it

```sh
# no model, ~10 s: fixtures build, graders catch planted faults, hooks deny/block/restore/fail open
bun apps/studio/test/agent-evals/run.mjs smoke

# one trial / one A∥B pair (symmetric machine load) — through the shared lane
scripts/v2-test-lane.sh -- bun apps/studio/test/agent-evals/run.mjs trial --task e1 --topology A
scripts/v2-test-lane.sh -- bun apps/studio/test/agent-evals/run.mjs pair  --task e1

# the pilot (10 tasks × A/B × 1) or the full run (30 × 2 × 3); each pair takes the lane on its own
bun apps/studio/test/agent-evals/run.mjs suite --tasks pilot --trials 1 --out /tmp/agent-evals/pilot
bun apps/studio/test/agent-evals/run.mjs suite --tasks all --trials 3 --out /tmp/agent-evals/full --skip-done
bun apps/studio/test/agent-evals/run.mjs report --out /tmp/agent-evals/full
```

Options: `--model` (default `claude-opus-5-5`), `--effort` (`high`), `--budget-usd` per trial (6),
`--timeout-min` (25), `--hooks on|off`, `--render on|off`, `--judge on|off`, `--judge-model`
(`sonnet`). Outputs default to `$TMPDIR/maude-agent-evals/<date>/` — **never inside the repo**:
Claude Code reads `CLAUDE.md` from every parent of its working directory, and this repo's
`CLAUDE.md` must not reach the agent under test. Never commit outputs.

## What a trial is

1. The fixture is built once into `<out>/fixtures/<name>/project` (a `git init`ed, **unlinked**
   project — no `linkedHub`, `_sync.json` or `_state` from the source) and APFS-cloned per trial.
2. `claude -p "<the person's words>"` runs in the clone with: only this worktree's plugins
   (`--setting-sources project`, no account MCP servers), the ACP chat's default permissions
   (`Read Glob Grep Bash(maude:*)`, in-project edits auto-accepted, everything else denied —
   nobody answers prompts), `PATH` starting with `shim/` so `maude` is this worktree's CLI, and
   `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1` on every server boot. Behaviour switches of the parent session
   (agent teams, messaging sockets, effort, stop-hook cap) are stripped from the environment.
3. Graders, in order (K-agent-architecture §3.4):
   - **code** (`lib/grade.mjs`) — invariants: `check` green · file and artboard scope ·
     `data-cd-id`s kept · locked elements untouched · no Bash writes/`rm` into `.design/` ·
     sub-agents wrote only their `owns` · busy artboard and held object untouched · new
     annotations authored by AI · a DS switch produced a review, not an apply · hidden ballots
     neither read nor disclosed · canvas removal went to the trash; plus task-specific quality
     signals (new artboards, recoloured stickies, proposals that apply cleanly…);
   - **render** (`lib/render.mjs`) — screenshots of the touched artboards, blank-capture check;
   - **model** (`lib/judge.mjs`) — a read-only judge with the task's rubric and an `unknown` exit.
4. Metrics per trial: tokens (all models incl. sub-agents), fresh tokens (without cache reads),
   cost (list), wall time, sub-agent spawns, hook denials/blocks and their latencies.

A trial that ended without a result (network, rate limit, timeout) is a **harness failure**: it
is excluded from pass rates and must be re-run (`suite --skip-done` re-runs what is missing).

## Metrics and the decision rule

- `pass^k` (invariants must hold on every trial), `pass@k` (quality on at least one), tokens,
  wall time, sub-agent count — per task and per helper (`summary.md`).
- A helper stays (S12 builds it) only if, on the tasks it is meant for, B **wins on quality or
  latency at ≤ 1.5× A's tokens with no drop in invariant pass^k**.

## Files

| Path | What |
| --- | --- |
| `run.mjs` | CLI: fixtures · trial · pair · suite · grade · report · smoke |
| `tasks.json` | the 30 tasks (`pilot: true` = the 10-task slice), expectations, rubrics |
| `lib/fixtures.mjs` | the six fixtures (app5, marketing21, board300, video, multids, busy) |
| `lib/tsx.mjs` | canvas scan: artboards, authored ids, locks, prints, artboard attribution |
| `lib/check.mjs` | prototype `maude design check` fast tier (TSX ids/locks, strict annotations, meta) |
| `lib/grade.mjs` · `render.mjs` · `judge.mjs` · `report.mjs` · `smoke.mjs` | graders, report, self-test |
| `harness/hook.mjs` · `plugin/hooks/hooks.json` | prototype hook set (deny-only, fail-open) |
| `harness/handoff.schema.json` | prototype `maude.agent-handoff/1` |
| `harness/verbs.mjs` · `shim/maude` | `maude` → worktree CLI + stand-ins for `check` / `trash` / `runs` |
| `topologies/` | the shared v2 rules, A and B instructions, B's helper agents |

The marketing fixture copies `~/Maude/alligators` (override with `MAUDE_EVAL_ALLIGATORS`); its
tasks are skipped on a Mac without it.
