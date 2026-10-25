---
"@1agh/maude": minor
---

Flow: new `/flow:run <plan>` runs a plan unattended as a goal. It arms the run and prints the `/goal` line to paste; while the plan's acceptance criteria are open or the done check is red, an opt-in Stop hook keeps the session working. It is capped: off unless `run.hooks: true`, tied to the arming session, expires after 24 h (72 h at most), keeps its record outside the project so a cloned repo cannot arm it, pauses itself after 3 reds of the same shape or 30 blocks or at `run.budget.maxRunTokens`, and every block message names the kill switch (`/flow:run --pause`, `--stop`, or `FLOW_RUN_HOOKS=0`). Sub-agents get the context-budget rules injected and are asked once for a `## Decisions` section. `--status`, `--pause` and `--resume` cover a run in progress.
