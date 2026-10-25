---
"@1agh/maude": minor
---

Flow: plans run cheaper by default. `/flow:execute` now hands each task to a fresh `flow:worker` agent with only that task's slice of the plan, instead of growing one huge context (measured: the lead was 84–100 % of spend, with contexts near 1M). New role agents `flow:worker`, `flow:spike` and `flow:scout` pick a model tier, and design and flow critics run on the fast tier. A new `run` block in `.ai/workflows.config.json` sets tiers, risk classes, a budget preset (`small` / `default` / `monorepo`), gate cadence and a test lane — all optional. `maude flow usage [sessionId]` shows tokens, turns and peak context per agent and flags agents over budget.
