# P2 dogfood — /flow:run end to end (2026-10-25, Claude Code 2.1.307)

Scratch git repo, `run: { hooks: true, maxStopBlocks: 3, budget: { preset: "small" } }`, a two-task plan
(`a.txt` = alpha, `b.txt` = beta) with two acceptance criteria. `claude -p --plugin-dir <worktree>/plugins/flow`.

| Check | Session | Result |
| --- | --- | --- |
| `/flow:run <plan> --done-cmd …` arms with the right session id and prints the `/goal` line | sonnet `0dcb4abf…` | marker `sessionId` = the session's own id; `GOAL: /goal Every acceptance criterion … is ticked and \`…\` passes` |
| Stop on red keeps the session going | same | told to stop after Task 1 → Stop hook blocked ("2 acceptance criteria open") → the session did Task 2, ticked both criteria |
| Stop on green ends the session | same | done command green, criteria ticked → the session ended (5 turns) |
| 3 identical reds pause the run and let it stop | haiku `08b491ca…`, `--done-cmd false`, told not to fix anything | blocks `1/3`, `2/3`, `3/3`, then the hook wrote `.ai/state/run-waiting.md` ("repeated 3 times") and the session ended |
| Waiting file honoured | same | the stop after the waiting file was written went through |
| No config / no marker → no hook output | haiku, plain scratch dir | 1 turn, the only hook event in the transcript is SessionStart |
| Every block names the kill switch | unit test `red doneCmd → blocked …` | `/flow:run --pause`, `--stop`, `FLOW_RUN_HOOKS=0` |

`expires` and `maxRunTokens` are covered by `run-hook.test.mjs` (planted transcripts), not live.
Unit suite: 24 tests green; 11 red against `noop-hook.mjs` (fail-first).
