## Auto-critic loop — default behavior of /design:edit and /design:new

After every successful edit/generate, the orchestrator runs auto-critic by default. The user can opt out with `--no-critic`, or escalate with `--perfect [N]`.

The default loop is **multi-axis** — it does not exit just on "blockers == 0", because correctness ≠ aspiration. It exits when the canvas is **solid for review**: correctness blockers cleared AND aspiration ≥ threshold AND no further gains in the last round (stable). If those can't be reached, it surfaces with a diagnostic, not silent.

Each round is the same pipeline as `/design:critic`: **deterministic checks → render → keeper → at most 3 critics** (`_guide-09`), each critic spawned with a `maude.agent-handoff/1` hand-off. The critics only report; **you apply the fixes**, and the design plugin's hooks snapshot and check every edit you make. Unlike an explicit `/design:critic`, the loop **never posts comments** — one round per edit would bury the thread. The findings stay in the run folder (`panel-<n>.md`).
