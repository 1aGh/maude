# T0 — plugin hook and goal capabilities (2026-10-25, Claude Code 2.1.307)

Measured in a scratch project (`claude -p --plugin-dir <scratch plugin>`), a throwaway plugin with one
agent and one hook script that logged every payload. Real HOME (an isolated HOME pops the keychain
dialog — memory `maude-fake-home-real-claude-keychain`); nothing under HOME was written except the
session transcript.

| Claim | Result | Evidence |
| --- | --- | --- |
| (a) plugin `hooks.json` registers SubagentStart, SubagentStop, Stop | **yes** | all three fired for a plugin agent spawn; payload keys logged (`agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`, `effort`) |
| (a') SubagentStart `hookSpecificOutput.additionalContext` reaches the sub-agent | **yes** | the injected rule appeared in the sub-agent transcript and it obeyed it |
| (b) Stop `{decision:"block", reason}` is honoured | **yes** | the lead continued, did what the reason asked, and the next Stop arrived with `stop_hook_active: true` |
| (c) plugin agent `model:` / `effort:` frontmatter is honoured | **yes** | lead on Sonnet, agent `model: haiku` ran `claude-haiku-5-5`; SubagentStop reported `effort: {level: "low"}` from `effort: low` |
| (d) the model can arm `/goal` itself | **no** | no tool sets a goal or invokes built-in slash commands (`Skill` runs skills only). `/flow:run` prints the `/goal` line for the user |
| (e) a Stop block does not swallow a typed `/compact` | **partly** | v2 run (2.1.28x): a typed `/compact` queues while the goal keeps the turn alive and runs once the lead pauses (waiting file). `run --pause` tells the user to compact then |

**Minimum Claude Code:** 2.1.280 for the run hooks (the v2 harness ran there); 2.1.307 is the version this
note verified. Pinned as `claude` soft dependency `minVersion` in `plugins/flow/dependencies.json`.

**Consequence for the plan:** no amendment — P2 keeps the hook design. The only change is (d): `run`
always prints the goal line.
