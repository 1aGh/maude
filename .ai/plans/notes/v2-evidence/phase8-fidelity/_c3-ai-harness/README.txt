Changes to the stage-D harnesses for p8-c3-ai (copy over _d-harness-g1):
  s01ai.mjs     folds the AI panel before the agent finishes so the done toast shows (cf-ai-done.toast), then reopens it for cf-ai-done
  g1-agent.mjs  the fake agent now writes the canvas through the design plugin's hook code (prompt / pre-edit / post-edit) so the run registry
                leases and attributes like Claude Code's own (rings, holds, "Made by AI"); fake-acp/ in the g1 harness
Notes for the next person:
  - the g2 scenarios (s03a/b/c) import ./fx.mjs and ./fx2.mjs, which live in _d-harness-g1 (copy them next to fx3.mjs)
  - `pairs.mjs` in the g2 harness rebuilds EVERY canvas (03, 04, 06) and overwrites the committed jpgs of the ones it has no fresh frames for:
    run it only after re-shooting all three, or `git checkout -- <04-modes|06-advanced>` afterwards
  - run.mjs prints through a pipe that buffers until the scenario ends: a silent log is not a hang
