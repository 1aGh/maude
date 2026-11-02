# G2 fidelity harness (03 AI Chat, 04 Modes, 06 Advanced)

Scripts that made the stage-A evidence. They hard-code the absolute paths of the worktree they ran in
(`/Users/iagh/git/personal/maude/.claude/worktrees/agent-a45b4750975bd8337`, with `.scr/` as scratch);
change `REPO`/`W` before reuse. `fx.mjs` / `fx2.mjs` (base fixture helpers) come from the lead's
`polish1-wbs` harness and are not copied.

- `spec.mjs` renders every artboard of a canvas from a scratch copy of `.design/` (own studio on :4711), host theme dark then light.
- `fake-agent.mjs` is a scripted ACP agent (prompt words: hang / permission / question / fail / tell) that runs the design plugin's hook code.
- `fx3.mjs` (Alligators brand + Combine-kampan), `fx4.mjs` (Studio site: Homepage, Pricing, Combine-kampan).
- `s03*.mjs`, `s04*.mjs`, `s06*.mjs` are the scenarios; `run.mjs` + `lib.mjs` + `go.sh` run one (`go.sh s03a dark,light`).
- `pairs.mjs` + `pairs-map.json` build the SPEC | IMPL pairs; `gen-index.mjs` + `rows.json` + `labels.json` write the INDEX files.
