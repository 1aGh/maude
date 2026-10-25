# Agent eval (V2-1.18, ported to the shipped build in V2-8.16b)

A headless eval of how Claude edits a Maude project, through the **released** `design` plugin of this
worktree (`claude -p --plugin-dir plugins/design`): its own hooks, the shipped `maude design` verbs and a
throwaway studio per trial. It decided the v2 agent topology in Phase 1 (V2-1.18, contract note
`apps/studio/client/v2/contracts/V2-1.18-agent-topology.md`) and is the regression slice V2-8.16 runs on the
final build. **Not a CI gate**: it costs real model usage and minutes per trial.

- **Topology A** — one writer (the main agent) + skills. The only side V2-8.16 runs.
- **Topology B** — A + three prototype helpers (`topologies/b/plugin/agents/`). Phase 1 dropped all three
  (nothing ships them); kept only so the Phase 1 numbers stay reproducible.

## What a trial is

1. The fixture is built once into `<out>/fixtures/<name>/project` (a `git init`ed, **unlinked** project) and
   APFS-cloned per trial.
2. **The trial boots its own studio** on the clone (`lib/trial.mjs`, as agent-journeys' terminal lane does):
   `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, its own `MAUDE_MACHINE_FILE`, a **throwaway HOME / XDG** with the stub
   `claude` first on PATH (`scripts/lib/stub-claude.mjs`) — the studio never touches `~/.config/maude`, the
   keychain or the real `claude`. The busy fixture's "another AI is changing the hub artboard" is made real:
   a second hook session claims it through `run/begin` + `edit/check`, so `maude design runs list` and the
   hook's `artboard-busy` deny read the real registry. The harness checks the hold is in the registry before
   the model starts and again at grade time (`hold-in-force`; a lost hold is a harness failure, not a grade).
3. `claude -p "<the person's words>"` runs in the clone with the released plugin (`--plugin-dir plugins/design`,
   `--include-hook-events`; no prototype plugin), the studio brief the AI chat carries (`acp/bootstrap-brief.ts`),
   the eval's task rules (`topologies/contract.md`, `--rules off` drops them), the chat's tool set
   (`Read Glob Grep Bash(maude:*)`, in-project edits accepted, nobody answers prompts — the allow list is
   broader than the chat's because nobody can approve the prompt-tier `curl-local` that creating or trashing a
   canvas needs), and `PATH` starting with `shim/` so `maude` is this worktree's CLI. Only this process keeps
   the person's HOME (its login lives there); `XDG_CONFIG_HOME` still points into the trial.
4. Graders, in order (K-agent-architecture §3.4):
   - **code** (`lib/grade.mjs`) — invariants: `maude design check` green (the shipped verb, strict, against
     the run's base `_runs/<session>/base/…` else the git baseline) · file and artboard scope · `data-cd-id`s
     kept · locked elements untouched · no Bash writes/`rm` into `.design/` · sub-agents wrote only their
     `owns` · busy artboard and locked object untouched · `hold-in-force` · new annotations authored by AI · a
     DS switch produced a review, not an apply · hidden ballots neither read nor disclosed · a removed canvas
     went to the trash; quality signals incl. `run-log:busy-not-touched` (the run folder's `touched.json`) and
     `stop-gate-settled` (a Stop block must not end on a failing check). Hook decisions are read from what the
     shipped hooks leave: error results the model saw (deny codes), the run folder (`stop-last*.json`), hook
     events in the transcript — `lib/runstate.mjs`. The released hooks keep no latency log, so `hooks.ms` is empty.
   - **render** (`lib/render.mjs`) — screenshots of the touched artboards on the trial's studio.
   - **model** (`lib/judge.mjs`) — a read-only judge with the task's rubric and an `unknown` exit.
5. The studio is stopped after every trial (also on a crash), then the metrics are written.

A trial that ended without a result (network, rate limit, timeout, a lost hold) is a **harness failure**:
excluded from pass rates and re-run (`suite --skip-done` re-runs what is missing).

## Run it

```sh
# no model, no spend
bun apps/studio/test/agent-evals/run.mjs smoke                 # ~10 s: fixtures, graders, run-state readers
bun apps/studio/test/agent-evals/run.mjs dry                   # ~2 min: a SCRIPTED agent through the real hooks,
                                                               #   a real studio and the real registry (4 tasks, 7 trials)
bun apps/studio/test/agent-evals/run.mjs preflight             # is `claude` signed in? (`claude auth status`, no model turn)

# the live run (spends money) — see .ai/plans/notes/v2-evidence/V2-8.16-ai-parity.md § 4 for the exact command
bun apps/studio/test/agent-evals/run.mjs suite --tasks all --topology A --trials 3 --skip-done --out "$TMPDIR/maude-agent-evals/v2-8.16"
bun apps/studio/test/agent-evals/run.mjs report --out "$TMPDIR/maude-agent-evals/v2-8.16"

# one trial through the shared lane
scripts/v2-test-lane.sh -- bun apps/studio/test/agent-evals/run.mjs trial --task e1 --topology A
```

`suite` takes the lane per trial itself (do not wrap it in the lane) and runs the preflight once up front.
Options: `--model` (default `claude-opus-5-5`), `--effort` (`high`), `--budget-usd` per trial (6),
`--timeout-min` (25), `--topology A|B|A,B` (suite; default both), `--rules on|off`, `--render on|off`,
`--judge on|off`, `--judge-model` (`sonnet`), `--no-preflight`. Outputs default to
`$TMPDIR/maude-agent-evals/<date>/` — **never inside the repo**: Claude Code reads `CLAUDE.md` from every
parent of its working directory, and this repo's `CLAUDE.md` must not reach the agent under test. Never
commit outputs.

The dry run's scripts live in `lib/dry-scripts.mjs`: per task a good run (must grade green and leave the
shipped hooks' evidence) and planted faults (each must flip its grader). It never calls a model — no judge,
a stub `claude` first on PATH for the whole process. In the suite it is opt-in:
`MAUDE_EVAL_DRY=1 … bun test ./test/agent-evals/harness.test.ts`.

## Metrics and the decision rule

- `pass^k` (invariants must hold on every trial), `pass@k` (quality on at least one), tokens, wall time,
  sub-agent count — per task (`summary.md`).
- The Phase 1 helper rule (B stays only if it wins at ≤ 1.5× A's tokens with no drop in invariant pass^k) is
  closed: no helper survived. V2-8.16 only needs A's invariant pass^3.

## Files

| Path | What |
| --- | --- |
| `run.mjs` | CLI: preflight · fixtures · trial · pair · suite · dry · grade · report · smoke |
| `tasks.json` | the 30 tasks (`pilot: true` = the 10-task slice), expectations, rubrics |
| `lib/fixtures.mjs` | the six fixtures (app5, marketing21, board300, video, multids, busy) |
| `lib/trial.mjs` | the per-trial throwaway studio, the busy-artboard hold, `runs list` |
| `lib/runstate.mjs` | reads the shipped hooks' run folder, the deny results, the registry answer |
| `lib/realcheck.mjs` | the `check` invariant = `maude design check` |
| `lib/fake-agent.mjs` · `lib/dry-scripts.mjs` · `lib/dry.mjs` | the dry run |
| `lib/grade.mjs` · `render.mjs` · `judge.mjs` · `report.mjs` · `smoke.mjs` · `tsx.mjs` | graders, report, self-test |
| `harness/handoff.schema.json` | the Phase 1 hand-off schema; `cli/lib/handoff-schema.test.mjs` pins the shipped copy to it |
| `shim/maude` | `maude` → this worktree's CLI (every verb is the shipped one) |
| `topologies/` | the eval's task rules, A and B instructions, B's helper agents |

The marketing fixture copies `~/Maude/alligators` (override with `MAUDE_EVAL_ALLIGATORS`); its tasks are
skipped on a Mac without it.
